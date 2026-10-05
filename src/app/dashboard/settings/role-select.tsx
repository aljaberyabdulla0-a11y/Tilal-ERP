"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type RoleOption = { code: string; name_ar: string; base_role: string };

// قائمة الأدوار تُجلب مرة واحدة لكل الصفوف
let rolesCache: Promise<RoleOption[]> | null = null;
function loadRoles(): Promise<RoleOption[]> {
  if (!rolesCache) {
    const supabase = createClient();
    rolesCache = Promise.resolve(
      supabase
        .from("roles")
        .select("code, name_ar, base_role")
        .eq("status", "نشط")
        .order("sort_order")
    ).then(({ data }) => (data ?? []) as RoleOption[]);
  }
  return rolesCache;
}

// مكوّن تغيير دور مستخدم (يظهر في صفحة الإعدادات للمدير).
//
// الأدوار من جدول roles (sql/146)، والتعيين عبر assign_user_role(): للمدير
// وحده، لا لنفسه، ومسجَّل في سجلّ التدقيق. والمستوى الأمني (profiles.role)
// يُشتق من الدور في القاعدة — فكل سياسة قائمة تراه كما كانت.
//
// الدوران «موارد بشرية» و«محاسب» يقسمان عملَ الراتب قسمين: HR تبني
// الكشف، والمحاسب يعتمده فيدخل الدفاتر. لا تجمعهما في شخصٍ واحد (068).
export default function RoleSelect({
  userId,
  currentRole,
  isSelf,
}: {
  userId: string;
  currentRole: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [code, setCode] = useState<string>(currentRole);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (isSelf || currentRole === "broker") return;
    let alive = true;
    loadRoles().then((r) => alive && setRoles(r));
    supabase
      .from("profiles")
      .select("role_code")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive && data?.role_code) setCode(data.role_code as string);
      });
    return () => {
      alive = false;
    };
  }, [userId, isSelf, currentRole]);

  // منع المدير من تغيير دور نفسه (حتى لا يقفل حسابه بالخطأ) — والقاعدة تمنعه أيضاً
  if (isSelf) {
    return <span className="text-xs text-gray-400">(أنت — لا يمكنك تغيير دورك)</span>;
  }
  // «شركة وسيطة» تُضبط عند ربط الحساب بشركة من صفحة الشركة، فالدور بلا ربط لا يعمل
  if (currentRole === "broker") {
    return <span className="text-xs text-gray-400">يُدار من صفحة الشركة الوسيطة</span>;
  }

  async function changeRole(newCode: string) {
    setSaving(true);
    setMsg(null);
    const { error } = await supabase.rpc("assign_user_role", { p_user: userId, p_role_code: newCode });
    setSaving(false);
    if (error) {
      setMsg({ ok: false, text: "خطأ: " + error.message });
      return;
    }
    setCode(newCode);
    setMsg({ ok: true, text: "تم الحفظ ✓" });
    router.refresh();
  }

  const options = roles.filter((r) => r.base_role !== "broker");

  return (
    <div className="flex items-center gap-2">
      <select
        value={code}
        onChange={(e) => changeRole(e.target.value)}
        disabled={saving || options.length === 0}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
      >
        {options.length === 0 && <option value={code}>…</option>}
        {options.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name_ar}
          </option>
        ))}
      </select>
      {saving && <span className="text-xs text-gray-400">جاري الحفظ...</span>}
      {msg && !saving && (
        <span className={`text-xs ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</span>
      )}
    </div>
  );
}
