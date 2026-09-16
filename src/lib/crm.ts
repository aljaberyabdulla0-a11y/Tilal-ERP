import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// ============================================================
// طبقة الوصول إلى دوال الـCRM في القاعدة (sql/070–080).
//
// ⚠️ **لا حساب هنا.** كل رقم يأتي محسوباً من القاعدة كما هو.
//
// السبب ليس تفضيلاً معمارياً بل تجربة: «معدّل الإغلاق» كان يُحسب
// في مكانين بطريقتين — بيع ÷ مغلقة في جدول الفريق، وبيع ÷ الإجمالي
// في جدول المصادر — فظهر المصدر الواحد بـ١٪ وصاحبه بـ٥٠٪، وقرأت
// الإدارة الرقمين معاً. الدوال أدناه مجرّد نقل: أي `map` أو `filter`
// يغيّر رقماً هنا يُعيد المشكلة من بابها.
//
// ملفوفة بـ cache() لنطاق الطلب الواحد: الصفحة تسأل عن المؤشّرات
// من التخطيط والمحتوى معاً، فتُحسب مرة وتُعاد بقية المرات.
// ============================================================

// ===== الأنواع — مطابقة لأعمدة returns table في القاعدة =====

export type CrmKpis = {
  leads: number;
  opportunities: number;
  open_count: number;
  won_count: number;
  lost_count: number;
  conversion_rate: number;
  pipeline_value: number;
  weighted_pipeline: number;
  won_value: number;
  avg_deal_value: number;
  avg_sales_cycle: number;
  median_sales_cycle: number;
  overdue_count: number;
  neglected_count: number;
  hot_count: number;
  activities: number;
};

export type FunnelStep = {
  stage_name: string;
  stage_order: number;
  reached: number;
  still_here: number;
  reached_pct: number;
  step_conversion: number | null;
  drop_off_pct: number | null;
  avg_days: number | null;
  median_days: number | null;
  value_here: number;
};

export type OwnerLoad = {
  owner_id: string;
  owner_name: string;
  total_leads: number;
  open_leads: number;
  won_leads: number;
  lost_leads: number;
  never_contacted: number;
  unworked: number;
  neglected: number;
  overdue: number;
  last_activity: string | null;
  over_capacity: boolean;
};

export type DistributionAlert = {
  severity: "عالٍ" | "متوسط" | "منخفض";
  code: string;
  title: string;
  detail: string;
  subject_id: string | null;
  metric: number;
  recommendation: string;
};

export type UnworkedLead = {
  client_id: string;
  client_name: string;
  phone: string | null;
  stage: string;
  source: string | null;
  owner_id: string | null;
  owner_name: string | null;
  assigned_at: string;
  days_since_assignment: number;
  days_silent: number;
};

export type SourceRow = {
  source_name: string;
  leads: number;
  qualified: number;
  opportunities: number;
  won: number;
  lost: number;
  conversion_rate: number;
  won_value: number;
  avg_deal_value: number;
  avg_cycle_days: number;
};

export type TeamRow = {
  owner_id: string;
  owner_name: string;
  leads_received: number;
  avg_lead_score: number;
  leads_worked: number;
  unworked: number;
  activities: number;
  contact_rate: number;
  opportunities: number;
  won: number;
  lost: number;
  conversion_rate: number;
  won_value: number;
  avg_cycle_days: number;
  overdue: number;
};

export type NextBestAction = {
  priority: number;
  action: string;
  reason: string;
  link: string;
};

export type HealthComponent = {
  component: string;
  value: number;
  note: string;
};

export type MatchedUnit = {
  unit_id: string;
  unit_code: string | null;
  project_name: string | null;
  unit_type: string | null;
  space_m2: number | null;
  rooms: number | null;
  price: number | null;
  match_score: number;
  reasons: string[];
};

export type DataQualityIssue = {
  severity: "عالٍ" | "متوسط" | "منخفض";
  code: string;
  title: string;
  affected: number;
  fix_path: string;
};

export type ScoreReason = { code: string; label: string; points: number };

export type LeadScore = {
  client_id: string;
  score: number;
  temperature: string;
  reasons: ScoreReason[];
  computed_at: string;
};

export type ForecastRow = {
  period: string;
  closed_value: number;
  commit_value: number;
  best_case_value: number;
  closed_count: number;
  commit_count: number;
  open_count: number;
  undated_count: number;
};

// ============================================================
// ⚠️ الأخطاء تُبتلع ويُعاد فراغ — عمداً، وبشرطين.
//
// الهجرات 070–080 قد لا تكون شُغّلت بعد على القاعدة، ودالة غير
// موجودة تُرجع خطأً يُسقط الصفحة كلها. وسقوط لوحة التوزيع لأن
// جدولاً واحداً ناقص أسوأ من عرض ما توفّر.
//
// والشرطان: (١) الخطأ يُطبع في سجلّ الخادم فلا يختفي بلا أثر،
// (٢) كل شاشة تفرّق بين «فارغ» و«غير متاح» في العرض — لا تقول
// «لا توجد بيانات» وهي لا تعرف.
// ============================================================
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[crm] فشل استدعاء ${fn}:`, error.message);
    return [];
  }
  return (data ?? []) as T[];
}

// ===== المؤشّرات والتقارير (076) =====

export type CrmFilters = {
  from?: string | null;
  to?: string | null;
  ownerId?: string | null;
  teamId?: string | null;
  projectId?: string | null;
  sourceId?: string | null;
};

export const getCrmKpis = cache(async (f: CrmFilters = {}): Promise<CrmKpis | null> => {
  const rows = await rpc<CrmKpis>("crm_kpis", {
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_owner_id: f.ownerId ?? null,
    p_team_id: f.teamId ?? null,
    p_project_id: f.projectId ?? null,
    p_source_id: f.sourceId ?? null,
  });
  return rows[0] ?? null;
});

export const getFunnel = cache(async (f: CrmFilters = {}) =>
  rpc<FunnelStep>("crm_funnel", {
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_owner_id: f.ownerId ?? null,
    p_project_id: f.projectId ?? null,
    p_source_id: f.sourceId ?? null,
  })
);

export const getSourcePerformance = cache(async (f: CrmFilters = {}) =>
  rpc<SourceRow>("crm_source_performance", { p_from: f.from ?? null, p_to: f.to ?? null })
);

export const getTeamPerformance = cache(async (f: CrmFilters = {}) =>
  rpc<TeamRow>("crm_team_performance", {
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_team_id: f.teamId ?? null,
  })
);

export const getForecast = cache(async (months = 3) =>
  rpc<ForecastRow>("crm_forecast", {
    p_months: months,
    p_owner_id: null,
    p_project_id: null,
  })
);

// ===== التوزيع (073) =====

export const getOwnerLoad = cache(async () => rpc<OwnerLoad>("crm_owner_load"));

export const getDistributionAlerts = cache(async () =>
  rpc<DistributionAlert>("crm_distribution_alerts")
);

export const getUnworkedLeads = cache(async (ownerId: string | null = null) =>
  rpc<UnworkedLead>("crm_unworked_leads", { p_owner_id: ownerId })
);

// ===== العميل الواحد (074 · 080) =====

export const getNextBestAction = cache(async (clientId: string) =>
  rpc<NextBestAction>("crm_next_best_action", { p_client_id: clientId })
);

export const getCustomerHealth = cache(async (clientId: string) =>
  rpc<HealthComponent>("crm_customer_health", { p_client_id: clientId })
);

export const getMatchedUnits = cache(async (clientId: string, limit = 10) =>
  rpc<MatchedUnit>("match_units_for_client", { p_client_id: clientId, p_limit: limit })
);

// ===== جودة البيانات (077) =====

export const getDataQuality = cache(async () => rpc<DataQualityIssue>("crm_data_quality"));

// ============================================================
// درجات الليدات — قراءة جدول لا دالة، فنقرأها مباشرةً بمفاتيح
// العملاء المعروضين وحدهم. جلب الجدول كاملاً لعرض عشرين صفّاً
// هدرٌ يكبر مع نمو البيانات.
// ============================================================
export async function getLeadScores(clientIds: string[]): Promise<Map<string, LeadScore>> {
  const out = new Map<string, LeadScore>();
  if (clientIds.length === 0) return out;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_lead_scores")
    .select("client_id, score, temperature, reasons, computed_at")
    .in("client_id", clientIds);

  if (error) {
    console.error("[crm] فشل جلب درجات الليدات:", error.message);
    return out;
  }
  for (const row of (data ?? []) as LeadScore[]) out.set(row.client_id, row);
  return out;
}

// ============================================================
// العرض — ألوان ثابتة للمعاني الثابتة.
//
// درجة الحرارة أربع قيم تأتي من القاعدة (074). لا نحسبها هنا
// ولا نعيد تصنيفها — نلوّنها فقط.
// ============================================================
export const TEMPERATURE_STYLE: Record<string, string> = {
  "ساخن": "bg-red-100 text-red-700",
  "دافئ": "bg-amber-100 text-amber-700",
  "بارد": "bg-blue-100 text-blue-700",
  "خامل": "bg-gray-100 text-gray-500",
};

export const SEVERITY_STYLE: Record<string, string> = {
  "عالٍ": "border-red-300 bg-red-50 text-red-900",
  "متوسط": "border-amber-300 bg-amber-50 text-amber-900",
  "منخفض": "border-gray-300 bg-gray-50 text-gray-700",
};

// درجة الليد: لونها يتبع عتبات القاعدة نفسها (٧٠ و٤٠ في 074)
export function scoreStyle(score: number | null | undefined): string {
  const s = score ?? 0;
  if (s >= 70) return "bg-brand-100 text-brand-700";
  if (s >= 40) return "bg-amber-100 text-amber-700";
  return "bg-gray-100 text-gray-500";
}
