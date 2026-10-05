"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SalaryHistoryRow, formatPrice } from "@/lib/types";

// تاريخ الراتب + تعديله بتاريخ سريان وسبب — adjust_salary() (sql/148).
// القاعدة تحسب السابق والنسبة، وترفض ما يمسّ كشفاً معتمداً.
export default function SalaryPanel({
  employeeId,
  history,
  today,
  canEdit,
}: {
  employeeId: string;
  history: SalaryHistoryRow[];
  today: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [effective, setEffective] = useState(today);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("adjust_salary", {
      p_employee: employeeId,
      p_amount: Number(amount),
      p_effective: effective,
      p_reason: reason,
    });
    setSaving(false);
    if (error) return setMsg({ ok: false, text: error.message });
    const r = data as { current_changed: boolean; drafts_to_rebuild: string | null };
    setMsg({
      ok: true,
      text:
        "حُفظ ✓" +
        (r.current_changed ? "" : " — سطرٌ رجعيّ؛ الراتب الحالي لم يتغيّر لأن بعده تعديلاً أحدث.") +
        (r.drafts_to_rebuild ? ` أعِد بناء مسوّدات: ${r.drafts_to_rebuild}.` : ""),
    });
    setOpen(false);
    setAmount("");
    setReason("");
    router.refresh();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">تاريخ الراتب</h3>
        {canEdit && !open && (
          <button onClick={() => setOpen(true)} className="rounded-lg border px-3 py-1.5 text-sm text-brand-700 hover:bg-gray-50">
            تعديل الراتب
          </button>
        )}
      </div>

      {msg && (
        <p className={`mb-3 rounded p-2 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</p>
      )}

      {open && (
        <form onSubmit={save} className="mb-4 grid grid-cols-1 gap-3 rounded-xl bg-gray-50 p-4 sm:grid-cols-4">
          <label className="text-xs text-gray-600">
            الراتب الجديد (د.ع) *
            <input className={input} type="number" min="0" step="any" dir="ltr" required value={amount}
              onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="text-xs text-gray-600">
            يسري من *
            <input className={input} type="date" dir="ltr" required max={today} value={effective}
              onChange={(e) => setEffective(e.target.value)} />
          </label>
          <label className="text-xs text-gray-600 sm:col-span-2">
            السبب *
            <input className={input} required value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="زيادة سنوية، ترقية، تصحيح…" />
          </label>
          <div className="flex gap-2 sm:col-span-4">
            <button disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? "جاري الحفظ..." : "حفظ"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-4 py-2 text-sm text-gray-600">
              إلغاء
            </button>
          </div>
        </form>
      )}

      {history.length === 0 ? (
        <p className="text-sm text-gray-400">لا تاريخ مسجَّل.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b text-gray-500">
              <tr>
                <th className="py-2 text-start font-medium">يسري من</th>
                <th className="py-2 text-start font-medium">السابق</th>
                <th className="py-2 text-start font-medium">الجديد</th>
                <th className="py-2 text-start font-medium">التغيّر</th>
                <th className="py-2 text-start font-medium">السبب</th>
                <th className="py-2 text-start font-medium">اعتمده</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b last:border-0">
                  <td className="py-2" dir="ltr">{h.effective_from}</td>
                  <td className="py-2 text-gray-500" dir="ltr">{h.previous_amount != null ? formatPrice(h.previous_amount) : "—"}</td>
                  <td className="py-2 font-medium" dir="ltr">{formatPrice(h.amount)}</td>
                  <td className={`py-2 ${h.change_pct != null && h.change_pct < 0 ? "text-red-600" : "text-green-700"}`} dir="ltr">
                    {h.change_pct != null ? `${h.change_pct > 0 ? "+" : ""}${h.change_pct}%` : "—"}
                  </td>
                  <td className="py-2 text-gray-600">{h.reason ?? "—"}</td>
                  <td className="py-2 text-gray-500">{h.approved_by_name ?? h.created_by_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
