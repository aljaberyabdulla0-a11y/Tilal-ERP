// ============================================================
// marketing-sync — مزامنة منصّات الإعلان (sql/126)
//
// لماذا دالّة حافّة؟ مفتاح المنصّة في Vault، ولا يقرؤه إلا service_role
// (mkt_integration_secret). فالدالّة تقرؤه هنا ولا يصل متصفّحاً ولا Vercel.
//
// الأنماط:
//   { mode: "manual", integration_id }  — «زامن الآن»، بجلسة مستخدم
//                                          يملك الكتابة في التسويق
//   { mode: "scheduled" }               — كل تكامل فعّال حان دوره، بترويسة
//                                          x-cron-secret (السرّ في Vault، sql/200)
//   { mode: "subscribe_page", integration_id } — اشتراك صفحة التكامل بليدات
//                                          النماذج (leadgen)، لمدير التسويق
//
// الموصّل الجاهز: Meta (رؤى الإعلانات اليومية لآخر ٧ أيام على مستوى
// الإعلان). يُنشئ الحملات الإعلانية ومجموعاتها وإعلاناتها في
// mkt_ad_objects، ويربط الحملة الإعلانية بحملة تلال حين يكون رمز حملة
// تلال رقمَها عند ميتا، أو يحمل اسمها رمزها (cmp-0001)، أو يُضبط ربطها
// في mapping.campaigns. والمصروف بالدينار بسعر mapping.usd_rate (أو 1520).
// ثم المقاييس عبر mkt_import_metrics — المسار نفسه لاستيراد CSV.
//
// كل محاولة صفٌّ في mkt_sync_logs (بدأ/اكتمل/فشل/إعادة محاولة)، وثلاث
// محاولات بمهلة متزايدة. ولا يُكتب في السجلّ رمزٌ ولا حمولة.
//
// المتغيّرات: SUPABASE_URL، SUPABASE_SERVICE_ROLE_KEY، SUPABASE_ANON_KEY
// (تلقائية). MKT_CRON_SECRET اختياري — المجدول يتحقّق بسرّ Vault.
// النشر: supabase functions deploy marketing-sync --no-verify-jwt
//   (المجدول بلا JWT؛ الدالّة تتحقّق بنفسها: السرّ، أو can_write_marketing
//    بجلسة المستخدم — والجلسة الفارغة لا تملكها)
// ============================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v21.0";
const DEFAULT_USD_RATE = 1520; // السعر الرسمي في العراق — يُبدَّل لكل تكامل من شاشته
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Integration = {
  id: string; provider: string; name: string; account_ref: string | null; account_id: string | null; page_ref: string | null;
  sync_frequency: string; mapping: { usd_rate?: number; campaigns?: Record<string, string> } | null; is_active: boolean;
  last_sync_at: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST فقط" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let body: { mode?: string; integration_id?: string };
  try { body = await req.json(); } catch { return reply({ error: "طلب تالف" }, 400); }

  let targets: Integration[] = [];
  let trigger = "يدوي";

  if (body.mode === "scheduled") {
    // السرّ في Vault (200) — أو MKT_CRON_SECRET إن ضُبط في أسرار الدوالّ
    const given = req.headers.get("x-cron-secret") ?? "";
    const env = Deno.env.get("MKT_CRON_SECRET");
    const ok = (env && given === env) || (given && (await admin.rpc("mkt_cron_secret_ok", { p_secret: given })).data === true);
    if (!ok) return reply({ error: "غير مسموح" }, 401);
    trigger = "مجدول";
    // المهمة كل ساعة (200): «كل ساعة» كل مرة، و«يومي» إن مضى ٢٠ ساعة على آخر محاولة
    // (لا آخر نجاح: تكاملٌ معطّل لا يُعاد كل ساعة)
    const { data } = await admin.from("mkt_integrations").select("*").eq("is_active", true).neq("sync_frequency", "يدوي");
    const dayAgo = Date.now() - 20 * 3600_000;
    targets = ((data ?? []) as Integration[]).filter((i) =>
      i.sync_frequency === "كل ساعة" || !i.last_sync_at || Date.parse(i.last_sync_at) < dayAgo);
  } else {
    // جلسة المستخدم: الصلاحية تقرّرها القاعدة (can_write_marketing) لا هذه الدالّة
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: ok } = await asUser.rpc(body.mode === "subscribe_page" ? "is_marketing_manager" : "can_write_marketing");
    if (ok !== true) return reply({ error: body.mode === "subscribe_page" ? "الاشتراك لمدير التسويق" : "المزامنة لفريق التسويق" }, 403);
    const { data } = await admin.from("mkt_integrations").select("*").eq("id", body.integration_id ?? "").maybeSingle();
    if (!data) return reply({ error: "التكامل غير موجود" }, 404);
    if (body.mode === "subscribe_page") {
      try { return reply({ message: await subscribePage(admin, data as Integration) }); }
      catch (e) { return reply({ error: e instanceof Error ? e.message : String(e) }, 502); }
    }
    targets = [data as Integration];
  }

  const results: { name: string; ok: boolean; rows?: number; error?: string }[] = [];
  for (const it of targets) results.push(await syncWithRetry(admin, it, trigger));

  const failed = results.filter((r) => !r.ok);
  return reply({
    results,
    message: failed.length
      ? `فشل: ${failed.map((f) => `${f.name} — ${f.error}`).join(" · ")}`
      : `تمّ: ${results.map((r) => `${r.name} (${r.rows ?? 0} صفّاً)`).join(" · ") || "لا تكاملات"}`,
  }, failed.length && results.length === 1 ? 502 : 200);
});

async function syncWithRetry(admin: SupabaseClient, it: Integration, trigger: string) {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data: logId } = await admin.rpc("mkt_sync_begin", { p_integration: it.id, p_trigger: trigger, p_attempt: attempt });
    try {
      const out = await syncOne(admin, it);
      await admin.rpc("mkt_sync_finish", { p_log: logId, p_ok: true, p_rows: out.rows, p_error: null, p_meta: out.meta });
      return { name: it.name, ok: true, rows: out.rows };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      const permanent = e instanceof PermanentError;
      await admin.rpc("mkt_sync_finish", { p_log: logId, p_ok: false, p_rows: null, p_error: last, p_meta: { attempt } });
      if (permanent) break;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return { name: it.name, ok: false, error: last };
}

class PermanentError extends Error {}

async function syncOne(admin: SupabaseClient, it: Integration): Promise<{ rows: number; meta: Record<string, unknown> }> {
  if (it.provider !== "meta") {
    throw new PermanentError(`موصّل ${it.provider} غير مبني بعد — استورد المقاييس بملف CSV من صفحة الإعلانات`);
  }
  if (!it.account_ref || !/^act_\d+$/.test(it.account_ref)) throw new PermanentError("معرّف الحساب يجب أن يكون act_ ثم أرقام");
  if (!it.account_id) throw new PermanentError("اربط التكامل بحساب إعلانات في تلال (الحسابات ← حساب إعلانات)");

  const { data: token } = await admin.rpc("mkt_integration_secret", { p_integration: it.id });
  if (!token) throw new PermanentError("لا مفتاح محفوظ — اضبطه من شاشة التكاملات");

  const acct = await graph(`${GRAPH}/${it.account_ref}?fields=currency,name`, token as string);
  const currency = String(acct.currency ?? "USD");
  // سعر الدولار من التكامل (شاشة التكاملات)، وإلا الرسمي — ولا يُفترض لعملة أخرى
  const rate = currency === "IQD" ? 1 : Number(it.mapping?.usd_rate ?? (currency === "USD" ? DEFAULT_USD_RATE : 0));
  if (currency !== "IQD" && !(rate > 0)) {
    throw new PermanentError(`عملة الحساب ${currency}: اضبط سعر الصرف (كم ديناراً للوحدة) في التكامل`);
  }

  // ===== الرؤى اليومية على مستوى الإعلان، بالترقيم =====
  type Row = Record<string, unknown> & { actions?: { action_type: string; value: string }[]; video_play_actions?: { value: string }[] };
  const rows: Row[] = [];
  let next: string | null =
    `${GRAPH}/${it.account_ref}/insights?level=ad&time_increment=1&date_preset=last_7d&limit=500` +
    `&fields=campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,actions,video_play_actions,date_start`;
  while (next) {
    const page = await graph(next, token as string);
    rows.push(...((page.data ?? []) as Row[]));
    next = (page.paging as { next?: string } | undefined)?.next ?? null;
    if (rows.length > 50000) throw new Error("أكثر من ٥٠ ألف صفّ — ضيّق المدة");
  }

  // ===== الكيانات: حملة إعلانية ← مجموعة ← إعلان =====
  const { data: tilal } = await admin.from("crm_campaigns").select("id, code");
  const byCode = new Map((tilal ?? []).map((c: { id: string; code: string }) => [c.code, c.id]));
  // الربط: يدويٌّ في mapping، ثم رمز حملة تلال = رقم حملة ميتا، ثم رمزها (cmp-0001) في الاسم
  const resolve = (metaId: string, name: string) =>
    it.mapping?.campaigns?.[metaId] ?? byCode.get(metaId)
      ?? byCode.get((name.toLowerCase().match(/cmp-\d{4}/) ?? [""])[0]) ?? null;

  const uniq = <T,>(arr: T[], key: (t: T) => string) => Array.from(new Map(arr.map((x) => [key(x), x])).values());
  const camps = uniq(rows, (r) => String(r.campaign_id));
  for (const r of camps) {
    const tilalId = resolve(String(r.campaign_id), String(r.campaign_name ?? ""));
    await upsertObject(admin, {
      account_id: it.account_id, level: "حملة إعلانية", external_id: String(r.campaign_id), name: String(r.campaign_name ?? r.campaign_id),
      status: "نشط", ...(tilalId ? { campaign_id: tilalId } : {}),
    });
  }
  const ids = await objectIds(admin, it.account_id, "حملة إعلانية");
  for (const r of uniq(rows, (r) => String(r.adset_id))) {
    await upsertObject(admin, {
      account_id: it.account_id, level: "مجموعة إعلانية", external_id: String(r.adset_id), name: String(r.adset_name ?? r.adset_id),
      parent_id: ids.get(String(r.campaign_id)), status: "نشط",
    });
  }
  const setIds = await objectIds(admin, it.account_id, "مجموعة إعلانية");
  for (const r of uniq(rows, (r) => String(r.ad_id))) {
    await upsertObject(admin, {
      account_id: it.account_id, level: "إعلان", external_id: String(r.ad_id), name: String(r.ad_name ?? r.ad_id),
      parent_id: setIds.get(String(r.adset_id)), status: "نشط",
    });
  }
  const adIds = await objectIds(admin, it.account_id, "إعلان");

  // ===== المقاييس — عبر mkt_import_metrics كما في استيراد CSV =====
  const LEAD = new Set(["lead", "leadgen_grouped", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]);
  const metricRows = rows.map((r) => ({
    date: String(r.date_start), entity_type: "إعلان", entity_id: adIds.get(String(r.ad_id)),
    spend: Math.round(Number(r.spend ?? 0) * rate),
    impressions: Number(r.impressions ?? 0), reach: Number(r.reach ?? 0), clicks: Number(r.clicks ?? 0),
    link_clicks: Number(r.inline_link_clicks ?? 0),
    leads: (r.actions ?? []).filter((a) => LEAD.has(a.action_type)).reduce((s, a) => s + Number(a.value), 0),
    video_views: (r.video_play_actions ?? []).reduce((s, a) => s + Number(a.value), 0),
  })).filter((m) => m.entity_id);

  const { data: imp, error } = await admin.rpc("mkt_import_metrics", { p_rows: metricRows, p_source: "مزامنة" });
  if (error) throw new Error(`حفظ المقاييس: ${error.message}`);
  const res = imp as { ok: number; failed: number };
  return { rows: res.ok, meta: { currency, rate, fetched: rows.length, failed: res.failed, ad_campaigns: camps.length } };
}

// اشتراك صفحة فيسبوك بالتطبيق في حقل leadgen — بدونه لا يرسل Meta ليدات النماذج
// إلى meta-leads ولو ضُبط الويبهوك في التطبيق. يحتاج رمز الصفحة: يُشتقّ من رمز
// System User له صلاحيات الصفحة، وإلا فالرمز المحفوظ رمز صفحة أصلاً.
async function subscribePage(admin: SupabaseClient, it: Integration): Promise<string> {
  if (it.provider !== "meta") throw new Error("الاشتراك لتكامل Meta");
  if (!it.page_ref || !/^\d+$/.test(it.page_ref)) throw new Error("أضِف للتكامل معرّف صفحة فيسبوك (أرقام) — «عدّل»");
  const { data: token } = await admin.rpc("mkt_integration_secret", { p_integration: it.id });
  if (!token) throw new Error("لا مفتاح محفوظ — اضبطه أولاً");

  let pageToken = token as string;
  let pageName = it.page_ref;
  try {
    const p = await graph(`${GRAPH}/${it.page_ref}?fields=name,access_token`, token as string);
    if (typeof p.access_token === "string") pageToken = p.access_token;
    if (typeof p.name === "string") pageName = p.name;
  } catch { /* رمز صفحة أصلاً — يُجرَّب كما هو */ }

  const res = await fetch(`${GRAPH}/${it.page_ref}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pageToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "subscribed_fields=leadgen",
  });
  const json = await res.json().catch(() => ({})) as { success?: boolean; error?: { message?: string } };
  if (!res.ok || json.success !== true) {
    throw new Error(`Meta: ${json.error?.message ?? res.status} — الرمز يحتاج pages_manage_metadata و leads_retrieval على الصفحة`);
  }
  return `اشتُركت صفحة «${pageName}» بالليدات — جرّبها بأداة اختبار ليدات ميتا`;
}

async function graph(u: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: number } }).error;
    // رمزٌ منتهٍ أو صلاحية ناقصة: لا فائدة من الإعادة
    if (res.status === 400 || res.status === 401 || res.status === 403 || err?.code === 190) {
      throw new PermanentError(`Meta: ${err?.message ?? res.status}`);
    }
    throw new Error(`Meta ${res.status}: ${err?.message ?? "خطأ"}`);
  }
  return json as Record<string, unknown>;
}

async function upsertObject(admin: SupabaseClient, row: Record<string, unknown>) {
  const { error } = await admin.from("mkt_ad_objects").upsert(row, { onConflict: "account_id,level,external_id" });
  if (error) throw new Error(`حفظ ${row.level}: ${error.message}`);
}

async function objectIds(admin: SupabaseClient, accountId: string, level: string): Promise<Map<string, string>> {
  const { data } = await admin.from("mkt_ad_objects").select("id, external_id").eq("account_id", accountId).eq("level", level);
  return new Map((data ?? []).map((o: { id: string; external_id: string }) => [o.external_id, o.id]));
}
