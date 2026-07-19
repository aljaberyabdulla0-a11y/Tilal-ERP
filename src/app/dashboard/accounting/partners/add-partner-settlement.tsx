"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Partner, formatPrice } from "@/lib/types";

// تسجيل تسوية: دفعة من شريك لآخر
export default function AddPartnerSettlement({
  partners,
  suggested,
}: {
  partners: Partner[];
  // اقتراح تلقائي: المدين يدفع للدائن المبلغ المستحق
  suggested?: { from: string; to: string; amount: number };
}) {
  const router = useRouter();
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    from_partner: suggested?.from ?? partners[0]?.id ?? "",
    to_partner: suggested?.to ?? partners[1]?.id ?? "",
    amount: suggested?.amount ? String(Math.round(suggested.amount)) : "",
    settlement_date: today,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(f: keyof typeof form, v: string) {
    setForm((p) => ({ ...p, [f]: v }));
  }

  async function add() {
    setError(null);
    if (!form.amount || form.from_partner === form.to_partner) {
      setError("اختر شريكَين مختلفَين وأدخل المبلغ.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("partner_settlements").insert({
      from_partner: form.from_partner,
      to_partner: form.to_partner,
      amount: Number(form.amount),
      settlement_date: form.settlement_date,
    });
    setSaving(false);
    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }
    router.refresh();
  }

  const cls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="rounded-xl border border-dashed border-gray-300 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-gray-500">الدافع (من)</label>
          <select value={form.from_partner} onChange={(e) => update("from_partner", e.target.value)} className={cls}>
            {partners.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">المستلم (إلى)</label>
          <select value={form.to_partner} onChange={(e) => update("to_partner", e.target.value)} className={cls}>
            {partners.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
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
          <label className="mb-1 block text-xs text-gray-500">التاريخ</label>
          <input type="date" dir="ltr" value={form.settlement_date} onChange={(e) => update("settlement_date", e.target.value)} className={cls + " text-left"} />
        </div>
        <button
          onClick={add}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "..." : "تسجيل تسوية"}
        </button>
      </div>
      {suggested && suggested.amount > 0 && (
        <p className="mt-2 text-xs text-gray-400">
          الاقتراح: تسوية بمبلغ {formatPrice(suggested.amount)} لتصفية المديونية الحالية.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
