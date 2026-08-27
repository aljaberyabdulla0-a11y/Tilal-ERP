"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrokerUser } from "@/lib/types";

type FreeProfile = { id: string; email: string | null; role: string };

// ============================================================
// حسابات دخول الشركة.
//
// الحساب يُنشأ في Supabase (لوحة Authentication) ثم يُربط هنا:
// الربط يفعل شيئين معاً — يضيف صفّاً في broker_users ويحوّل دور
// الحساب إلى «شركة وسيطة». الاثنان لازمان: الأول يحدّد أي شركة،
// والثاني يفتح شاشات الوساطة ويغلق شاشات تلال الداخلية.
// ============================================================
export default function CompanyAccounts({
  companyId,
  accounts,
  freeProfiles,
}: {
  companyId: string;
  accounts: BrokerUser[];
  freeProfiles: FreeProfile[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [userId, setUserId] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!userId) {
      setError("اختر الحساب.");
      return;
    }

    setBusy(true);
    const { error: linkError } = await supabase.from("broker_users").insert({
      user_id: userId,
      company_id: companyId,
      full_name: fullName.trim() || null,
      phone: phone.trim() || null,
    });

    if (linkError) {
      setBusy(false);
      setError("تعذّر الربط: " + linkError.message);
      return;
    }

    const { error: roleError } = await supabase
      .from("profiles")
      .update({ role: "broker" })
      .eq("id", userId);

    setBusy(false);

    if (roleError) {
      setError(
        "رُبط الحساب بالشركة، لكن تعذّر تغيير دوره إلى «شركة وسيطة»: " +
          roleError.message
      );
      return;
    }

    setUserId("");
    setFullName("");
    setPhone("");
    router.refresh();
  }

  async function unlink(u: BrokerUser) {
    if (
      !confirm(
        `فكّ ربط ${u.full_name ?? "الحساب"} عن الشركة؟ لن يعود يرى ليداتها.`
      )
    )
      return;

    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("broker_users")
      .delete()
      .eq("user_id", u.user_id);
    setBusy(false);

    if (error) {
      setError("تعذّر فكّ الربط: " + error.message);
      return;
    }
    router.refresh();
  }

  const inputCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="glass-card p-6">
      <h2 className="mb-1 text-lg font-bold text-gray-800">
        حسابات دخول الشركة ({accounts.length})
      </h2>
      <p className="mb-4 text-sm text-gray-500">
        أنشئ الحساب أولاً في Supabase ← Authentication ← Add user، ثم اربطه
        بالشركة من هنا.
      </p>

      {accounts.length > 0 && (
        <div className="mb-4 space-y-2">
          {accounts.map((u) => (
            <div
              key={u.user_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-4 py-3"
            >
              <div>
                <b className="text-gray-800">{u.full_name ?? "حساب"}</b>
                {u.phone && (
                  <span className="ms-2 text-xs text-gray-500" dir="ltr">
                    {u.phone}
                  </span>
                )}
              </div>
              <button
                onClick={() => unlink(u)}
                disabled={busy}
                className="text-xs font-medium text-red-600 transition hover:underline disabled:opacity-50"
              >
                فكّ الربط
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={link} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            الحساب
          </label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className={inputCls + " min-w-[240px]"}
          >
            <option value="">— اختر حساباً غير مرتبط —</option>
            {freeProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.email ?? p.id}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            اسم المسؤول
          </label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            الهاتف
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputCls}
            dir="ltr"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !userId}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          ربط الحساب
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
