"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BROKER_LOGIN_DOMAIN, BrokerUser } from "@/lib/types";

// ============================================================
// حسابات دخول الشركة — تُنشأ من هنا مباشرةً (sql/117).
//
// الإنشاء يمرّ بدالّة الحافّة broker-accounts لا بالمتصفح: يحتاج مفتاح
// الخدمة الذي يتجاوز كل السياسات، فلا يُعطى للواجهة. والدالّة تتحقّق
// أن المنادي مدير، ثم تُنشئ الحساب وتحوّل دوره إلى «شركة وسيطة» وتربطه
// بالشركة في خطوة واحدة — فلا يبقى حسابٌ نصف مُعدّ.
//
// الإيقاف لا الحذف: الحساب الموقوف لا يدخل ولا يرى شيئاً، وتبقى
// ليداته وسجلّ تواصله منسوبةً إليه.
// ============================================================
export default function CompanyAccounts({
  companyId,
  accounts,
}: {
  companyId: string;
  accounts: BrokerUser[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState({ login: "", password: "", full_name: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function call(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error } = await supabase.functions.invoke("broker-accounts", { body });
    setBusy(false);

    // خطأ الدالّة يصل في جسم الردّ — نقرؤه لنعرض رسالتها العربية
    let message = (data as { error?: string } | null)?.error ?? null;
    if (error && !message) {
      try {
        const ctx = (error as { context?: Response }).context;
        message = ctx ? ((await ctx.json()) as { error?: string }).error ?? error.message : error.message;
      } catch {
        message = error.message;
      }
    }
    if (message) {
      setError(message);
      return false;
    }
    return true;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.login.trim() || form.password.length < 8) {
      setError("اكتب اسم الدخول وكلمة مرور من ٨ أحرف على الأقل.");
      return;
    }
    const ok = await call({ action: "create", company_id: companyId, ...form });
    if (!ok) return;
    setNotice(
      `أُنشئ الحساب. أعطِ الشركة: اسم الدخول «${form.login.trim()}» وكلمة المرور التي كتبتها.`
    );
    setForm({ login: "", password: "", full_name: "", phone: "" });
    router.refresh();
  }

  async function resetPassword(u: BrokerUser) {
    const password = prompt(`كلمة مرور جديدة لـ ${u.full_name ?? u.login_name ?? "الحساب"} (٨ أحرف على الأقل):`);
    if (!password) return;
    if (await call({ action: "reset_password", user_id: u.user_id, password })) {
      setNotice("غُيّرت كلمة المرور.");
    }
  }

  async function toggle(u: BrokerUser) {
    const next = !u.is_active;
    if (
      !next &&
      !confirm(`إيقاف حساب ${u.full_name ?? u.login_name ?? ""}؟ يخرج فوراً ولا يستطيع الدخول.`)
    )
      return;
    if (await call({ action: "set_active", user_id: u.user_id, active: next })) {
      router.refresh();
    }
  }

  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="glass-card p-6">
      <h2 className="mb-1 text-lg font-bold text-gray-800">
        حسابات دخول الشركة ({accounts.length})
      </h2>
      <p className="mb-4 text-sm text-gray-500">
        كل حساب يرى ليدات الشركة كلها، ووحدات مشاريعها، ويرفع طلبات الحجز.
      </p>

      {accounts.length > 0 && (
        <div className="mb-5 space-y-2">
          {accounts.map((u) => (
            <div
              key={u.user_id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 ${
                u.is_active ? "bg-gray-50" : "bg-gray-100 opacity-70"
              }`}
            >
              <div className="min-w-0">
                <b className="text-gray-800">{u.full_name ?? "حساب"}</b>
                {u.login_name && (
                  <span className="ms-2 text-xs text-gray-500" dir="ltr">
                    {u.login_name}
                  </span>
                )}
                {u.phone && (
                  <span className="ms-2 text-xs text-gray-500" dir="ltr">
                    {u.phone}
                  </span>
                )}
                {!u.is_active && (
                  <span className="ms-2 rounded-full bg-gray-300 px-2 py-0.5 text-xs font-semibold text-gray-700">
                    موقوف
                  </span>
                )}
              </div>
              <div className="flex gap-3 text-xs font-medium">
                <button
                  onClick={() => resetPassword(u)}
                  disabled={busy}
                  className="text-brand-700 hover:underline disabled:opacity-50"
                >
                  كلمة مرور جديدة
                </button>
                <button
                  onClick={() => toggle(u)}
                  disabled={busy}
                  className={`hover:underline disabled:opacity-50 ${
                    u.is_active ? "text-red-600" : "text-emerald-700"
                  }`}
                >
                  {u.is_active ? "إيقاف" : "تفعيل"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={create} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">اسم الدخول *</label>
          <input
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
            className={inputCls}
            dir="ltr"
            placeholder="ali.sarai أو بريد"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">كلمة المرور *</label>
          <input
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className={inputCls}
            dir="ltr"
            placeholder="٨ أحرف على الأقل"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">اسم المسؤول</label>
          <input
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">الهاتف</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className={inputCls}
            dir="ltr"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "جارٍ..." : "إنشاء حساب"}
        </button>
      </form>
      <p className="mt-2 text-xs text-gray-400">
        اسم الدخول بلا «@» يكفي — يدخل به الوسيط من شاشة الدخول كما هو (يُحفظ
        داخلياً على <span dir="ltr">@{BROKER_LOGIN_DOMAIN}</span>).
      </p>

      {notice && (
        <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>
      )}
      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
    </div>
  );
}
