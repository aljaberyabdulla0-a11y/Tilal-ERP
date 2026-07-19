"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Partner } from "@/lib/types";

// إضافة مصروف مشترك (مع تحديد من دفعه)
export default function AddPartnerExpense({ partners }: { partners: Partner[] }) {
  const router = useRouter();
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    description: "",
    amount: "",
    paid_by: partners[0]?.id ?? "",
    expense_date: today,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(f: keyof typeof form, v: string) {
    setForm((p) => ({ ...p, [f]: v }));
  }

  async function add() {
    setError(null);
    if (!form.description.trim() || !form.amount || !form.paid_by) {
      setError("أكمل البيان والمبلغ ومن دفع.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("partner_expenses").insert({
      description: form.description.trim(),
      amount: Number(form.amount),
      paid_by: form.paid_by,
      expense_date: form.expense_date,
    });
    setSaving(false);
    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }
    setForm({ description: "", amount: "", paid_by: partners[0]?.id ?? "", expense_date: today });
    router.refresh();
  }

  const cls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="rounded-xl border border-dashed border-gray-300 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block text-xs text-gray-500">البيان</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            className={cls + " w-full"}
            placeholder="مثال: إيجار المكتب"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">المبلغ</label>
          <input
            type="number"
            min="0"
            dir="ltr"
            value={form.amount}
            onChange={(e) => update("amount", e.target.value)}
            className={cls + " w-32 text-left"}
            placeholder="0"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">من دفع؟</label>
          <select
            value={form.paid_by}
            onChange={(e) => update("paid_by", e.target.value)}
            className={cls}
          >
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">التاريخ</label>
          <input
            type="date"
            dir="ltr"
            value={form.expense_date}
            onChange={(e) => update("expense_date", e.target.value)}
            className={cls + " text-left"}
          />
        </div>
        <button
          onClick={add}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "..." : "+ إضافة مصروف"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
