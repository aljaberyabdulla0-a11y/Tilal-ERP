"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// نسبة حركة أو كشف راتب إلى مشروع بعد تسجيله (sql/116). الحركات القديمة
// تبقى «عامة» حتى تُنسب هنا، والكشف يأخذ مشروع موظفه ويُغيَّر هنا إن عمل
// على غيره. القيد يتبع مصدره تلقائياً (محفّز في القاعدة)، والمبلغ لا يتغيّر،
// والشهر المقفل محاسبياً يرفض.
export default function ProjectSelect({
  table,
  rowId,
  value,
  projects,
}: {
  table: "cash_moves" | "payrolls";
  rowId: string;
  value: string | null;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [current, setCurrent] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  async function change(next: string) {
    const prev = current;
    setCurrent(next);
    setSaving(true);
    const { error } = await supabase
      .from(table)
      .update({ project_id: next || null })
      .eq("id", rowId);
    setSaving(false);
    if (error) {
      setCurrent(prev);
      alert("تعذّر تغيير المشروع: " + error.message);
      return;
    }
    router.refresh();
  }

  return (
    <select
      value={current}
      disabled={saving}
      onChange={(e) => change(e.target.value)}
      className={`max-w-[150px] rounded-lg border px-2 py-1 text-xs focus:border-brand-500 focus:outline-none disabled:opacity-50 ${
        current ? "border-brand-200 bg-brand-50 text-brand-800" : "border-gray-200 text-gray-500"
      }`}
    >
      <option value="">عام</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
