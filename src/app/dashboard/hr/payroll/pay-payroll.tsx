"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/types";

// ============================================================
// زر «دفع الراتب» — يسجّل الدفعة كاملة أو جزئية،
// والنظام ينقص الصندوق/البنك ويقلّل الدَين المستحق للموظف تلقائياً.
// ============================================================
export default function PayPayroll({
  payrollId,
  employeeName,
  period,
  remaining,
}: {
  payrollId: string;
  employeeName: string;
  period: string;
  remaining: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(Math.round(remaining)));
  const [payDate, setPayDate] = useState(today);
  const [method, setMethod] = useState<"نقد" | "بنك">("نقد");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount) || 0;
  const partial = value > 0 && value < remaining - 0.01;

  async function pay() {
    setError(null);
    if (value <= 0) return setError("اكتب المبلغ المدفوع.");
    if (value > remaining + 0.01)
      return setError(`المبلغ أكبر من المتبقّي (${formatPrice(remaining)}).`);

    setSaving(true);
    const { error } = await supabase.from("payroll_payments").insert({
      payroll_id: payrollId,
      pay_date: payDate,
      amount: value,
      method,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) return setError("تعذّر الحفظ: " + error.message);

    setOpen(false);
    setNotes("");
    router.refresh();
  }

  if (remaining <= 0.01) return null;

  if (!open) {
    return (
      <button
        onClick={() => {
          setAmount(String(Math.round(remaining)));
          setOpen(true);
        }}
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
      >
        دفع
      </button>
    );
  }

  const cls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-gray-800">دفع راتب</h3>
        <p className="mt-1 text-sm text-gray-500">
          {employeeName} — {period}
        </p>
        <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
          المتبقّي عليه:{" "}
          <b className="text-gray-900" dir="ltr">
            {formatPrice(remaining)}
          </b>{" "}
          دينار
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs text-gray-500">المبلغ المدفوع الآن</label>
            <input
              type="number"
              min="0"
              dir="ltr"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={cls + " w-full text-start text-lg font-bold"}
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setAmount(String(Math.round(remaining)))}
                className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                المبلغ كامل
              </button>
              <button
                type="button"
                onClick={() => setAmount(String(Math.round(remaining / 2)))}
                className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                نصف المبلغ
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500">التاريخ</label>
              <input
                type="date"
                dir="ltr"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className={cls + " w-full text-start"}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">من وين؟</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as "نقد" | "بنك")}
                className={cls + " w-full"}
              >
                <option value="نقد">الصندوق (نقد)</option>
                <option value="بنك">البنك</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">ملاحظات (اختياري)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={cls + " w-full"}
              placeholder="مثال: سلفة على الراتب"
            />
          </div>

          <div className="rounded-lg bg-brand-50 px-3 py-2 text-xs leading-relaxed text-gray-700">
            {partial
              ? `دفع جزئي: سيبقى ${formatPrice(remaining - value)} دينار مستحقاً للموظف، وتصير حالة الكشف «مدفوع جزئياً».`
              : "سيُسدَّد الراتب بالكامل وتصير حالة الكشف «مدفوع»."}{" "}
            وينقص {method === "بنك" ? "رصيد البنك" : "الصندوق"} بمقدار{" "}
            {formatPrice(value)} تلقائياً.
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={pay}
              disabled={saving}
              className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "جارٍ الحفظ..." : "تأكيد الدفع"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-gray-600 transition hover:bg-gray-50"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
