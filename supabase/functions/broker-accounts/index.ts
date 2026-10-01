// ============================================================
// broker-accounts — حسابات دخول الشركات الوسيطة (sql/117)
//
// لماذا دالّة حافّة لا شاشة؟ إنشاء مستخدم في Supabase Auth يحتاج
// مفتاح الخدمة (service_role)، وهذا المفتاح يتجاوز كل سياسات القاعدة
// فلا يجوز أن يصل للمتصفح ولا لمتغيّرات Vercel العامة. هنا يبقى داخل
// Supabase، والدالّة تتحقّق أن المنادي مديرٌ قبل أي شيء.
//
// الأفعال:
//   create          { company_id, login, password, full_name?, phone? }
//   reset_password  { user_id, password }
//   set_active      { user_id, active }
//
// «login» بريدٌ أو اسم مستخدم. اسم المستخدم يصير بريداً داخلياً
// <name>@brokers.tilal.invalid — النطاق .invalid محجوز (RFC 2606) فلا
// يذهب إليه بريد أبداً، وشاشة الدخول تُكمله بنفس اللاحقة.
//
// النشر: supabase functions deploy broker-accounts
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const LOGIN_DOMAIN = "brokers.tilal.invalid";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function loginToEmail(login: string): string {
  const v = login.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${LOGIN_DOMAIN}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST فقط" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // ===== من المنادي؟ =====
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(jwt);
  if (!who?.user) return reply({ error: "سجّل الدخول أولاً" }, 401);

  const { data: me } = await admin
    .from("profiles")
    .select("role")
    .eq("id", who.user.id)
    .maybeSingle();
  if (me?.role !== "admin") return reply({ error: "حسابات الشركات للمدير فقط" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "طلب غير مفهوم" }, 400);
  }

  const action = String(body.action ?? "");

  // ===== إنشاء =====
  if (action === "create") {
    const companyId = String(body.company_id ?? "");
    const login = String(body.login ?? "").trim();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim() || null;
    const phone = String(body.phone ?? "").trim() || null;

    if (!companyId) return reply({ error: "الشركة غير محدّدة" }, 400);
    if (!/^[a-zA-Z0-9._@+-]{3,}$/.test(login)) {
      return reply({ error: "اسم الدخول: ٣ أحرف إنجليزية أو أرقام على الأقل، أو بريد إلكتروني" }, 400);
    }
    if (password.length < 8) return reply({ error: "كلمة المرور ٨ أحرف على الأقل" }, 400);

    const { data: company } = await admin
      .from("broker_companies")
      .select("id")
      .eq("id", companyId)
      .maybeSingle();
    if (!company) return reply({ error: "الشركة غير موجودة" }, 404);

    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: loginToEmail(login),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, broker_company_id: companyId },
    });
    if (authError || !created?.user) {
      const taken = /already|registered|exists/i.test(authError?.message ?? "");
      return reply({ error: taken ? "اسم الدخول مستعمل لحساب آخر" : authError?.message ?? "تعذّر الإنشاء" }, 400);
    }
    const uid = created.user.id;

    // محفّز handle_new_user أنشأ الملف بدور «موظف» — نحوّله فوراً، ونخرجه
    // من قناة الإعلانات الداخلية التي يُضاف إليها كل حساب جديد.
    const steps = await Promise.all([
      admin.from("profiles").update({ role: "broker" }).eq("id", uid),
      admin.from("broker_users").insert({
        user_id: uid,
        company_id: companyId,
        full_name: fullName,
        phone,
        login_name: login,
        is_active: true,
      }),
      admin.from("conversation_members").delete().eq("user_id", uid),
    ]);
    const failed = steps.find((s) => s.error);
    if (failed?.error) {
      // لا نترك حساباً بلا شركة يدخل بدور موظف
      await admin.auth.admin.deleteUser(uid);
      return reply({ error: "تعذّر ربط الحساب بالشركة: " + failed.error.message }, 500);
    }

    return reply({ ok: true, user_id: uid, email: loginToEmail(login) });
  }

  // الفعلان الباقيان على حسابٍ وسيطٍ قائم فقط — لا يمسّان موظفاً
  const userId = String(body.user_id ?? "");
  const { data: link } = await admin
    .from("broker_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!link) return reply({ error: "ليس حساب شركة وسيطة" }, 404);

  // ===== كلمة مرور جديدة =====
  if (action === "reset_password") {
    const password = String(body.password ?? "");
    if (password.length < 8) return reply({ error: "كلمة المرور ٨ أحرف على الأقل" }, 400);
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return reply({ error: error.message }, 400);
    return reply({ ok: true });
  }

  // ===== إيقاف / تفعيل =====
  // الإيقاف مزدوج: حظرٌ في Auth (لا دخول جديد) + is_active=false (تسقط
  // جلسته القائمة فوراً لأن my_broker_company() تشترطه).
  if (action === "set_active") {
    const active = Boolean(body.active);
    const { error } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: active ? "none" : "876000h",
    });
    if (error) return reply({ error: error.message }, 400);
    const { error: dbError } = await admin
      .from("broker_users")
      .update({ is_active: active })
      .eq("user_id", userId);
    if (dbError) return reply({ error: dbError.message }, 500);
    return reply({ ok: true });
  }

  return reply({ error: "فعل غير معروف" }, 400);
});
