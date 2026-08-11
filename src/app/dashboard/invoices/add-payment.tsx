"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { INVOICE_PAYMENT_METHODS, formatPrice } from "@/lib/types";

// تسجيل دفعة/قسط على فاتورة
export default function AddPayment({
  invoiceId,
  remaining,
}: {
  invoiceId: string;
  remaining: number;
}) {
  const router = useRouter();
  const supabase = createClient();

  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState("نقد");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    if (!amount || Number(amount) <= 0) {
      setError("أدخل مبلغاً صحيحاً.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("payments").insert({
      invoice_id: invoiceId,
      amount: Number(amount),
      payment_date: date,
      method,
    });
    setSaving(false);
    if (error) {
      setError("تعذّر التسجيل: " + error.message);
      return;
    }
    setAmount("");
    router.refresh();
  }

  const cls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">المبلغ</label>
          <input
            type="number"
            min="0"
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={cls + " w-36 text-start"}
            placeholder="0"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">التاريخ</label>
          <input
            type="date"
            dir="ltr"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={cls + " text-start"}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">الطريقة</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={cls}>
            {INVOICE_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => setAmount(String(remaining))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-100"
          >
            المتبقّي {formatPrice(remaining)}
          </button>
        )}
        <button
          onClick={add}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "..." : "تسجيل دفعة"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
