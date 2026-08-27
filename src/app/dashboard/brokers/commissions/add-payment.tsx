"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BROKER_PAYMENT_METHODS, formatPrice } from "@/lib/types";

// ============================================================
// صرف دفعة على عمولة شركة وسيطة.
//
// المبلغ الافتراضي هو **الباقي** لا كامل العمولة: أكثر الحالات صرفٌ
// لما تبقّى، والدفع الجزئي مسموح. ولا نمنع تجاوز الباقي في الواجهة
// بل نحذّر — قد يكون تصحيحاً مقصوداً، والقرار للمدير.
// ============================================================
export default function AddPayment({
  commissionId,
  remaining,
}: {
  commissionId: string;
  remaining: number;
}) {
  const router = useRouter();
  const supabase = createClient();

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Baghdad",
  });

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(remaining > 0 ? String(remaining) : "");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<string>(BROKER_PAYMENT_METHODS[0]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = Number(amount);
    if (!value || value <= 0) {
      setError("اكتب مبلغاً أكبر من صفر.");
      return;
    }

    setBusy(true);
    setError(null);
    const { error } = await supabase.from("broker_payments").insert({
      commission_id: commissionId,
      amount: value,
      payment_date: date,
      method,
      notes: notes.trim() || null,
    });
    setBusy(false);

    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }

    setOpen(false);
    setNotes("");
    router.refresh();
  }

  const cls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
      >
        صرف دفعة
      </button>
    );
  }

  return (
    <div className="min-w-[260px] space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <input
        type="number"
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="المبلغ"
        className={cls + " w-full"}
        dir="ltr"
      />
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className={cls + " w-full"}
        dir="ltr"
      />
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value)}
        className={cls + " w-full"}
      >
        {BROKER_PAYMENT_METHODS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="ملاحظات (اختياري)"
        className={cls + " w-full"}
      />

      {Number(amount) > remaining && remaining > 0 && (
        <p className="text-[11px] text-amber-700">
          المبلغ أكبر من الباقي ({formatPrice(remaining)}).
        </p>
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "..." : "حفظ"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-100"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
