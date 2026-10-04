"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PIPELINE_STAGES, PIPELINE_STAGE_COLORS } from "@/lib/types";
import ClientLostFlow from "@/components/lost-sale/client-lost-flow";

export type StageOption = { name: string; color: string; lost?: boolean };

// الافتراض القديم — يُستعمل حين لا تمرّر الصفحة مراحل من القاعدة
const FALLBACK_STAGES: StageOption[] = PIPELINE_STAGES.map((name) => ({
  name,
  color: PIPELINE_STAGE_COLORS[name] ?? "bg-gray-100 text-gray-700",
  lost: name === "فشل البيع",
}));

// ============================================================
// تغيير مرحلة العميل من أي مكان (القائمة، صفحة العميل...) —
// بلا فتح لوحة المبيعات. تغيير المرحلة يُسجَّل تلقائياً في سجلّ
// التواصل عبر محفّز في قاعدة البيانات.
// ============================================================
export default function StageSelect({
  clientId,
  stage,
  size = "sm",
  stages,
}: {
  clientId: string;
  stage: string | null | undefined;
  size?: "sm" | "md";
  // من crm_stages (sql/070) عبر getPipelineConfig() — اختيارية للتوافق
  stages?: StageOption[];
}) {
  const options = stages && stages.length > 0 ? stages : FALLBACK_STAGES;
  const router = useRouter();
  const supabase = createClient();

  const [value, setValue] = useState(stage ?? "ليد");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lostFlow, setLostFlow] = useState(false);
  // بعد إغلاق الفرصة بالنموذج تتغيّر مرحلة البطاقة في القاعدة (المرآة) — نتبعها
  useEffect(() => setValue(stage ?? "ليد"), [stage]);

  async function change(next: string, force = false) {
    if (next === value) return;
    // «فشل البيع» يُحلَّل على الفرصة لا يُكتب على البطاقة (140):
    // النموذج يغلق الفرصة، والبطاقة تتبعها بالمرآة إن كانت وحيدة.
    if (!force && options.find((s) => s.name === next)?.lost) {
      setLostFlow(true);
      return;
    }
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

  const color =
    options.find((s) => s.name === value)?.color ??
    PIPELINE_STAGE_COLORS[value] ??
    "bg-gray-100 text-gray-700";
  // المرحلة المحفوظة قد تكون معطَّلة الآن — تبقى ظاهرة كي لا يُفقد الخيار الحالي
  const shown = options.some((s) => s.name === value) ? options : [...options, { name: value, color }];
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
        {shown.map((s) => (
          <option key={s.name} value={s.name} className="bg-white text-gray-800">
            {s.name}
          </option>
        ))}
      </select>

      {error && <span className="text-[11px] text-red-600">{error}</span>}

      {lostFlow && (
        <ClientLostFlow
          clientId={clientId}
          onClose={() => setLostFlow(false)}
          onDone={() => router.refresh()}
          onNoOpportunity={() => {
            setLostFlow(false);
            change(options.find((s) => s.lost)?.name ?? "فشل البيع", true);
          }}
        />
      )}
    </div>
  );
}
