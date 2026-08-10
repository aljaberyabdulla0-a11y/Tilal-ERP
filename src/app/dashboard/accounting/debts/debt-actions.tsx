"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/types";
import { baghdadDate } from "@/lib/time";

const cls =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

// ============================================================
// تسجيل استحصال (كامل أو جزئي) على دَين، وحذف الدَّين كاملاً.
// الاستحصال يُرحَّل تلقائياً: يدخل الصندوق وينقص من ذمّة الشخص.
// ============================================================
export default function DebtActions({
  debtId,
  personName,
  remaining,
}: {
  debtId: string;
  personName: string;
  remaining: number;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(Math.round(remaining)));
  const [payDate, setPayDate] = useState(baghdadDate());
  const [method, setMethod] = useState("نقد");

  async function collect() {
    setError(null);
    const value = Number(amount);
    if (!value || value <= 0) {
      setError("اكتب مبلغاً أكبر من صفر.");
      return;
    }
    if (value > remaining + 0.01) {
      setError(`المتبقّي على ${personName} هو ${formatPrice(remaining)} فقط.`);
      return;
    }

    setBusy(true);
    const { error } = await supabase.from("debt_repayments").insert({
      debt_id: debtId,
      amount: value,
      pay_date: payDate,
      method,
    });
    setBusy(false);

    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function removeDebt() {
    if (
      !confirm(
        `حذف دَين ${personName} نهائياً مع كل استحصالاته؟ سيُحذف قيده من دفتر المحاسبة أيضاً.`
      )
    )
      return;

    setBusy(true);
    const { error } = await supabase.from("external_debts").delete().eq("id", debtId);
    setBusy(false);

    if (error) {
      setError("تعذّر الحذف: " + error.message);
      return;
    }
    router.refresh();
  }

  if (open) {
    return (
      <div className="inline-flex flex-col items-start gap-2 rounded-xl border border-gray-200 bg-white p-3 text-right shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min="0"
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={cls + " w-32 text-left"}
          />
          <input
            type="date"
            dir="ltr"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
            className={cls + " text-left"}
          />
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={cls}>
            <option value="نقد">للصندوق</option>
            <option value="بنك">للبنك</option>
          </select>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            onClick={collect}
            disabled={busy}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? "..." : "تأكيد الاستحصال"}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              setError(null);
              setAmount(String(Math.round(remaining)));
            }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-100"
          >
            إلغاء
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {remaining > 0.009 && (
        <button
          onClick={() => setOpen(true)}
          disabled={busy}
          className="whitespace-nowrap rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
        >
          تسجيل استحصال
        </button>
      )}
      <button
        onClick={removeDebt}
        disabled={busy}
        title="حذف الدَّين وكل استحصالاته"
        className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-red-600 transition hover:bg-red-50"
      >
        حذف
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
