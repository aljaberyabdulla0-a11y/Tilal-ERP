"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PIPELINE_STAGES, PIPELINE_STAGE_COLORS } from "@/lib/types";

// ============================================================
// تغيير مرحلة العميل من أي مكان (القائمة، صفحة العميل...) —
// بلا فتح لوحة المبيعات. تغيير المرحلة يُسجَّل تلقائياً في سجلّ
// التواصل عبر محفّز في قاعدة البيانات.
// ============================================================
export default function StageSelect({
  clientId,
  stage,
  size = "sm",
}: {
  clientId: string;
  stage: string | null | undefined;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const supabase = createClient();

  const [value, setValue] = useState(stage ?? "ليد");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    if (next === value) return;
    const previous = value;

    setValue(next); // تحديث فوري ثم تراجع عند الفشل
    setSaving(true);
    setError(null);

    const { error } = await supabase
      .from("clients")
      .update({ stage: next })
      .eq("id", clientId);

    setSaving(false);
    if (error) {
      setValue(previous);
      setError("تعذّر التغيير: " + error.message);
      return;
    }
    router.refresh();
  }

  const color = PIPELINE_STAGE_COLORS[value] ?? "bg-gray-100 text-gray-700";
  const sizing =
    size === "md" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs";

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        title="تغيير حالة العميل"
        aria-label="حالة العميل"
        className={`cursor-pointer rounded-full border-0 font-medium outline-none transition focus:ring-2 focus:ring-brand-500 disabled:opacity-50 ${color} ${sizing}`}
      >
        {PIPELINE_STAGES.map((s) => (
          <option key={s} value={s} className="bg-white text-gray-800">
            {s}
          </option>
        ))}
      </select>

      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}
