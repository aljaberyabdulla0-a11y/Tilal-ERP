import { cache } from "react";
import { getStages, getSettings, getSources } from "@/lib/crm";
import {
  PIPELINE_STAGES,
  PIPELINE_STAGE_COLORS,
  CLOSED_STAGES,
  CLIENT_SOURCES,
  type SilenceThresholds,
} from "@/lib/types";

// ============================================================
// ضبط الـCRM من القاعدة — بقيمة احتياطية تطابق السلوك القديم حرفياً.
//
// المراحل والمصادر وعتبات الصمت كانت ثوابت في types.ts لا يغيّرها
// إلا مطوّر (§71). الآن تُقرأ من crm_stages وcrm_sources وcrm_settings
// (sql/070)، وتسقط إلى الثوابت حين تغيب الجداول — فلا تتغيّر شاشة
// واحدة قبل تشغيل الهجرات، ولا تنكسر بعده.
//
// ⚠️ للخادم فقط. المكوّنات العميلة تستقبل ما تحتاجه props من
//    صفحتها، ولا تستورد هذا الملف.
// ============================================================

export type StageLite = { name: string; color: string; closed: boolean };

export type PipelineConfig = {
  stages: StageLite[];             // الفعّالة بترتيبها
  stageNames: string[];
  colors: Record<string, string>;  // بالاسم — يشمل غير الفعّالة كي لا تفقد لونها في التاريخ
  closed: string[];                // أسماء مراحل الفوز والخسارة
  silence: SilenceThresholds;
  sources: string[];               // الفعّالة بترتيبها
};

export const getPipelineConfig = cache(async (): Promise<PipelineConfig> => {
  const [stages, settings, sources] = await Promise.all([getStages(), getSettings(), getSources()]);

  const num = (key: string, fallback: number) => {
    const v = settings.find((s) => s.key === key)?.value;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const silence: SilenceThresholds = {
    green: num("silence_green_days", 7),
    amber: num("silence_amber_days", 21),
  };

  if (stages.length === 0) {
    return {
      stages: PIPELINE_STAGES.map((name) => ({
        name,
        color: PIPELINE_STAGE_COLORS[name] ?? "bg-gray-100 text-gray-700",
        closed: (CLOSED_STAGES as readonly string[]).includes(name),
      })),
      stageNames: [...PIPELINE_STAGES],
      colors: { ...PIPELINE_STAGE_COLORS },
      closed: [...CLOSED_STAGES],
      silence,
      sources: sources.length > 0 ? sources.filter((s) => s.is_active).map((s) => s.name) : [...CLIENT_SOURCES],
    };
  }

  const colors: Record<string, string> = { ...PIPELINE_STAGE_COLORS };
  for (const s of stages) colors[s.name] = s.color ?? colors[s.name] ?? "bg-gray-100 text-gray-700";

  const active = stages
    .filter((s) => s.is_active)
    .map((s) => ({ name: s.name, color: colors[s.name], closed: s.stage_type !== "open" }));

  return {
    stages: active,
    stageNames: active.map((s) => s.name),
    colors,
    closed: stages.filter((s) => s.stage_type !== "open").map((s) => s.name),
    silence,
    sources: sources.length > 0 ? sources.filter((s) => s.is_active).map((s) => s.name) : [...CLIENT_SOURCES],
  };
});
