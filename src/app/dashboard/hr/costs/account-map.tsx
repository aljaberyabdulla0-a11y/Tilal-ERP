"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ربط حسابات الرواتب (sql/158): يديره المحاسب. يسري على القيود التي تُرحَّل
// بعد التغيير (اعتماد أو إعادة فتح كشف، استحقاق عمولة، صرف سلفة).
export default function AccountMap({
  map,
  accounts,
  canEdit,
}: {
  map: { key: string; label: string; account_code: string }[];
  accounts: { code: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(key: string, code: string) {
    if (!confirm(`تغيير حساب «${key}» إلى ${code}؟ يسري على القيود القادمة.`)) return router.refresh();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("hr_account_map").update({ account_code: code }).eq("key", key);
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  if (map.length === 0) return null;

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <h3 className="mb-1 font-semibold text-gray-800">ربط الحسابات المحاسبية</h3>
      <p className="mb-3 text-xs text-gray-500">
        القيم الافتراضية هي الحسابات التي كان النظام يرحّل إليها. التغيير للمحاسب ويُسجَّل في سجلّ التدقيق.
      </p>
      {err && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}
      <table className="w-full text-sm">
        <tbody>
          {map.map((m) => (
            <tr key={m.key} className="border-b last:border-0">
              <td className="py-2">{m.label}</td>
              <td className="py-2 text-end">
                {canEdit && accounts.length > 0 ? (
                  <select disabled={busy} defaultValue={m.account_code} onChange={(e) => change(m.key, e.target.value)}
                    className="rounded border border-gray-300 px-2 py-1 text-xs">
                    {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                ) : (
                  <span className="font-mono text-xs" dir="ltr">{m.account_code}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
