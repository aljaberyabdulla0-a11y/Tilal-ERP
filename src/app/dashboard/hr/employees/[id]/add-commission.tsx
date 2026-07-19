"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// إضافة عمولة لموظف (للمدير)
export default function AddCommission({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!amount) return;
    setSaving(true);
    const { error } = await supabase.from("commissions").insert({
      employee_id: employeeId,
      amount: Number(amount),
      description: desc.trim() || null,
    });
    setSaving(false);
    if (error) {
      alert("تعذّر الحفظ: " + error.message);
      return;
    }
    setAmount("");
    setDesc("");
    router.refresh();
  }

  const cls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min="0"
        dir="ltr"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="المبلغ"
        className={cls + " w-32 text-left"}
      />
      <input
        type="text"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="الوصف (اختياري)"
        className={cls + " flex-1"}
      />
      <button
        onClick={add}
        disabled={saving || !amount}
        className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
      >
        + إضافة عمولة
      </button>
    </div>
  );
}
