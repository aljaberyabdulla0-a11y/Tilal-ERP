"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// مشروع العميل في شريط حالته (217).
//
// الموظف على أكثر من مشروع (216) يفرز عميله على مشروعه من هنا — بطاقة
// التعديل للمدير والمشرف وحدهما، والفرز عمل الموظف اليومي. القاعدة
// (set_client_project) تحرس: من يملك تعديل العميل، وفي مشاريع مالكه.
// والمسار المفتوح يلحق بالمشروع تلقائياً.
// ============================================================
export default function ClientProjectPicker({
  clientId,
  value,
  options,
}: {
  clientId: string;
  value: string | null;
  options: { id: string; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [current, setCurrent] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  async function change(next: string) {
    if (!next || next === current) return;
    const prev = current;
    setCurrent(next);
    setSaving(true);
    const { error } = await supabase.rpc("set_client_project", {
      p_client_id: clientId,
      p_project_id: next,
    });
    setSaving(false);
    if (error) {
      setCurrent(prev);
      alert("تعذّر تغيير المشروع: " + error.message);
      return;
    }
    router.refresh();
  }

  return (
    <label className="flex items-center gap-1.5 text-sm text-gray-500">
      المشروع:
      <select
        value={current}
        disabled={saving}
        onChange={(e) => change(e.target.value)}
        className={`rounded-lg border px-2 py-1 text-sm font-semibold focus:border-brand-500 focus:outline-none disabled:opacity-50 ${
          current ? "border-brand-200 bg-brand-50 text-brand-800" : "border-amber-300 bg-amber-50 text-amber-800"
        }`}
      >
        {!current && <option value="">— اختر المشروع —</option>}
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
