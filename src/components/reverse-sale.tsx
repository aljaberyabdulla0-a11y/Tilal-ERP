"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/types";

type Preview = {
  unit: string;
  client: string | null;
  status: string;
  sale_price: number | null;
  down_payment: number | null;
  confirmed_at: string | null;
  company_rate: number | null;
  company_amount: number | null;
  collected_at: string | null;
  invoices: { number: string; amount: number; sent: boolean; cancelled: boolean }[];
  employee: string | null;
  employee_amount: number | null;
  employee_action: string;
  impact: { code: string; name: string; debit: number; credit: number; note: string }[];
  can_reverse: boolean;
  blocked_reason: string | null;
};

// ============================================================
// فسخ البيع — للمدير. المعاينة أولاً (sale_reversal_preview — sql/113):
// ما سيُكتب في الدفاتر، وما يحدث لعمولة الموظف ولفاتورة المطوّر،
// ثم التنفيذ بسببٍ مكتوب (reverse_sale). الحجز المُرحَّل لا يُحذف
// منذ sql/108 — هذا هو الطريق الوحيد لإلغاء صفقة مؤكَّدة.
// ============================================================
export default function ReverseSale({ reservationId }: { reservationId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ company: string; employee: string } | null>(null);

  async function openPreview() {
    setOpen(true);
    setError(null);
    setDone(null);
    setBusy(true);
    const { data, error } = await supabase.rpc("sale_reversal_preview", { p_res: reservationId });
    setBusy(false);
    if (error) return setError(error.message);
    setPreview(data as Preview);
  }

  async function reverse() {
    setError(null);
    if (!reason.trim()) return setError("اكتب سبب الفسخ.");
    setBusy(true);
    const { data, error } = await supabase.rpc("reverse_sale", { p_res: reservationId, p_reason: reason.trim() });
    setBusy(false);
    if (error) return setError(error.message);
    setDone(data as { company: string; employee: string });
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <button
          onClick={openPreview}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
        >
          فسخ البيع…
        </button>
      </div>
    );
  }

  const p = preview;
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatPrice(Number(v)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-gray-800">فسخ البيع — معاينة</h3>

        {busy && !p && <p className="mt-4 text-sm text-gray-500">جارٍ التحضير…</p>}

        {p && !done && (
          <div className="mt-4 space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl bg-gray-50 p-4 sm:grid-cols-3">
              <div><dt className="text-xs text-gray-500">الوحدة</dt><dd className="font-medium">{p.unit}</dd></div>
              <div><dt className="text-xs text-gray-500">العميل</dt><dd className="font-medium">{p.client ?? "—"}</dd></div>
              <div><dt className="text-xs text-gray-500">سعر البيع</dt><dd dir="ltr">{fmt(p.sale_price)}</dd></div>
              <div>
                <dt className="text-xs text-gray-500">عمولة تلال</dt>
                <dd dir="ltr">{fmt(p.company_amount)}{p.company_rate ? ` (${p.company_rate}%)` : ""}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">التحصيل</dt>
                <dd>{p.collected_at ? `محصّلة ${p.collected_at.slice(0, 10)}` : "غير محصّلة"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">فواتير المطوّر</dt>
                <dd>
                  {p.invoices.length === 0
                    ? "لا فاتورة"
                    : p.invoices.map((i) => `${i.number}${i.cancelled ? " (ملغاة)" : ""}`).join("، ")}
                </dd>
              </div>
            </dl>

            <div className="rounded-xl border p-4">
              <p className="font-medium text-gray-800">عمولة الموظف</p>
              <p className="mt-1 text-gray-600">
                {p.employee ? `${p.employee} — ${fmt(p.employee_amount)} د.ع: ` : ""}
                {p.employee_action}
              </p>
            </div>

            <div className="rounded-xl border p-4">
              <p className="mb-2 font-medium text-gray-800">الأثر في الدفاتر</p>
              {p.impact.length === 0 ? (
                <p className="text-gray-500">لا قيد — لا استحقاق مسجّل لهذه الصفقة.</p>
              ) : (
                <table className="w-full text-start text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr><th className="pb-1">الحساب</th><th className="pb-1">مدين</th><th className="pb-1">دائن</th><th className="pb-1"></th></tr>
                  </thead>
                  <tbody>
                    {p.impact.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-1.5"><span className="font-mono text-gray-400" dir="ltr">{l.code}</span> — {l.name}</td>
                        <td className="py-1.5" dir="ltr">{l.debit ? fmt(l.debit) : "—"}</td>
                        <td className="py-1.5" dir="ltr">{l.credit ? fmt(l.credit) : "—"}</td>
                        <td className="py-1.5 text-xs text-gray-500">{l.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-xs text-gray-500">
                وتُلغى فاتورة المطوّر السارية، ويصير الحجز «ملغى»، وتعود الوحدة متاحة.
              </p>
            </div>

            {!p.can_reverse ? (
              <p className="rounded-lg bg-red-50 p-3 text-red-700">لا يُفسخ: {p.blocked_reason}</p>
            ) : (
              <div>
                <label className="mb-1 block text-xs text-gray-500">سبب الفسخ (يُحفظ في الحجز والقيد)</label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                  placeholder="مثال: العميل تراجع قبل توقيع العقد"
                />
              </div>
            )}
          </div>
        )}

        {done && (
          <div className="mt-4 space-y-2 rounded-xl bg-green-50 p-4 text-sm text-green-800">
            <p className="font-semibold">فُسخ البيع.</p>
            <p>عمولة تلال: {done.company}</p>
            <p>عمولة الموظف: {done.employee}</p>
          </div>
        )}

        {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex gap-2">
          {p?.can_reverse && !done && (
            <button
              onClick={reverse}
              disabled={busy}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "…" : "تأكيد الفسخ"}
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {done ? "إغلاق" : "إلغاء"}
          </button>
        </div>
      </div>
    </div>
  );
}
