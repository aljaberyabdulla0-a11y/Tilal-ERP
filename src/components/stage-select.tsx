"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PIPELINE_STAGES, PIPELINE_STAGE_COLORS } from "@/lib/types";
import { useStageMove } from "@/components/journey/use-stage-move";
import type { StageRule } from "@/lib/crm-journey";

export type StageOption = StageRule & { color: string };

// الافتراض القديم — يُستعمل حين لا تمرّر الصفحة مراحل من القاعدة
const FALLBACK_STAGES: StageOption[] = PIPELINE_STAGES.map((name) => ({
  name,
  color: PIPELINE_STAGE_COLORS[name] ?? "bg-gray-100 text-gray-700",
  lost: name === "فشل البيع",
  closed: name === "بيع" || name === "فشل البيع",
}));

// ============================================================
// تغيير مرحلة العميل من أي مكان (القائمة، صفحة العميل...).
//
// المرحلة مرحلة **مسار** العميل (201): القائمة تطلب النقل من الباب
// الواحد crm_move_client_stage، والقاعدة تحرّك المسار وتكتب البطاقة
// وسجلّ المراحل وسطر «تغيير مرحلة» معاً. الخسارة بنموذجها، والإغلاق غير
// التجاري بسببه، و«حجز» بالحجز نفسه.
// ============================================================
export default function StageSelect({
  clientId,
  stage,
  size = "sm",
  stages,
  isAdmin = false,
}: {
  clientId: string;
  stage: string | null | undefined;
  size?: "sm" | "md";
  // من crm_stages عبر getPipelineConfig() — اختيارية للتوافق
  stages?: StageOption[];
  isAdmin?: boolean;
}) {
  const options = stages && stages.length > 0 ? stages : FALLBACK_STAGES;
  const router = useRouter();

  const [value, setValue] = useState(stage ?? "ليد");
  const [saving, setSaving] = useState(false);
  // القاعدة قد تحرّك البطاقة بعد النموذج — نتبعها
  useEffect(() => setValue(stage ?? "ليد"), [stage]);

  const mover = useStageMove({
    stages: options,
    isAdmin,
    onMoved: (_id, s) => {
      if (s) setValue(s);
      router.refresh();
    },
  });

  async function change(next: string) {
    if (next === value) return;
    setSaving(true);
    await mover.request(clientId, value, next);
    setSaving(false);
  }

  const color =
    options.find((s) => s.name === value)?.color ??
    PIPELINE_STAGE_COLORS[value] ??
    "bg-gray-100 text-gray-700";
  // المرحلة المحفوظة قد تكون معطَّلة الآن — تبقى ظاهرة كي لا يُفقد الخيار الحالي
  const shown = options.some((s) => s.name === value) ? options : [...options, { name: value, color }];
  const sizing = size === "md" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs";

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={saving}
        title="مرحلة مسار العميل"
        aria-label="مرحلة مسار العميل"
        className={`cursor-pointer rounded-full border-0 font-medium outline-none transition focus:ring-2 focus:ring-brand-500 disabled:opacity-50 ${color} ${sizing}`}
      >
        {shown.map((s) => (
          <option key={s.name} value={s.name} className="bg-white text-gray-800">
            {s.name}
            {s.manual === false ? " (بالحجز)" : ""}
          </option>
        ))}
      </select>

      {mover.error && <span className="text-[11px] text-red-600">تعذّر النقل: {mover.error}</span>}
      {mover.dialogs}
    </div>
  );
}
