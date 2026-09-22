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

// ============================================================
// ما يلي أُضيف مع الشاشات السبع الباقية.
// ============================================================

export type StageDuration = {
  stage_name: string;
  transitions: number;
  avg_days: number;
  median_days: number;
  p90_days: number;
  max_days: number;
};

export type LostRow = {
  lost_reason: string;
  category: string;
  lost_count: number;
  lost_value: number;
  share_pct: number;
  avg_stage_reached: string | null;
};

export type Velocity = {
  qualified_opps: number;
  avg_deal_value: number;
  win_rate: number;
  avg_cycle_days: number;
  velocity_per_day: number;
  velocity_per_week: number;
  velocity_per_month: number;
};

export type TargetProgress = {
  target_id: string;
  scope: string;
  scope_id: string | null;
  scope_name: string;
  metric: string;
  target_value: number;
  achieved: number;
  remaining: number;
  achieved_pct: number;
  days_left: number;
  pipeline_open: number;
  weighted_open: number;
  pipeline_needed: number;
  on_track: boolean;
};

export type AttributionRow = {
  source_name: string;
  first_touch_leads: number;
  first_touch_won: number;
  last_touch_leads: number;
  last_touch_won: number;
  builds_demand: boolean;
};

export type SlaSummary = {
  rule_code: string;
  rule_label: string;
  breaches: number;
  still_open: number;
  escalated_l2: number;
  escalated_l3: number;
  avg_resolution_hours: number | null;
  worst_owner: string | null;
};

export type OpportunityRow = {
  id: string;
  client_id: string;
  client_name: string;
  owner_id: string | null;
  owner_name: string | null;
  project_id: string | null;
  project_name: string | null;
  unit_id: string | null;
  source_name: string | null;
  stage_id: string;
  stage_name: string;
  stage_type: "open" | "won" | "lost";
  stage_order: number;
  probability: number | null;
  expected_value: number | null;
  weighted_value: number;
  won_value: number | null;
  lost_reason: string | null;
  created_at: string;
  closed_at: string | null;
  expected_close_date: string | null;
  next_action_date: string | null;
  days_in_stage: number;
  days_open: number;
  days_silent: number;
  is_overdue: boolean | null;
  lead_score: number | null;
  lead_temperature: string | null;
};

export type Stage = {
  id: string;
  name: string;
  sort_order: number;
  stage_type: "open" | "won" | "lost";
  probability: number;
  sla_hours: number | null;
  requires_activity: boolean;
  required_fields: string[];
  color: string | null;
  is_active: boolean;
};

export type CrmSetting = {
  key: string;
  value: unknown;
  label: string;
  description: string | null;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  updated_at: string;
};

export type LostReason = { id: string; name: string; category: string | null; is_active: boolean; requires_note: boolean; sort_order: number };
export type Source = { id: string; name: string; category: string | null; is_active: boolean; sort_order: number };
export type ScoreRule = { code: string; label: string; points: number; param: number | null; is_active: boolean; sort_order: number };

export type DuplicatePair = {
  id: string;
  client_a: string;
  client_b: string;
  match_type: string;
  match_on: string;
  similarity: number | null;
  status: string;
  detected_at: string;
  a: { id: string; name: string; phone: string | null; stage: string; owner_id: string | null; created_at: string } | null;
  b: { id: string; name: string; phone: string | null; stage: string; owner_id: string | null; created_at: string } | null;
};

export const getStageDurations = cache(async () => rpc<StageDuration>("crm_stage_durations", { p_owner_id: null, p_project_id: null }));
export const getLostAnalysis = cache(async (f: CrmFilters = {}) => rpc<LostRow>("crm_lost_analysis", { p_from: f.from ?? null, p_to: f.to ?? null }));
export const getVelocity = cache(async (f: CrmFilters = {}): Promise<Velocity | null> => {
  const r = await rpc<Velocity>("crm_sales_velocity", { p_from: f.from ?? null, p_to: f.to ?? null, p_owner_id: f.ownerId ?? null });
  return r[0] ?? null;
});
export const getTargetProgress = cache(async (periodStart: string | null = null, periodType = "شهري") =>
  rpc<TargetProgress>("crm_target_progress", { p_period_start: periodStart, p_period_type: periodType })
);
export const getAttribution = cache(async () => rpc<AttributionRow>("crm_attribution", { p_from: null, p_to: null }));
export const getSlaSummary = cache(async () => rpc<SlaSummary>("crm_sla_summary", { p_from: null, p_to: null }));

// ===== قراءة الجداول والعروض مباشرةً (RLS تسري) =====

async function table<T>(name: string, build: (q: any) => any): Promise<T[]> {
  const supabase = await createClient();
  const { data, error } = await build(supabase.from(name));
  if (error) {
    console.error(`[crm] فشل قراءة ${name}:`, error.message);
    return [];
  }
  return (data ?? []) as T[];
}

export const getOpportunities = cache(async (opts: { stageType?: "open" | "won" | "lost" | null; limit?: number } = {}) =>
  table<OpportunityRow>("v_crm_opportunities", (q) => {
    let s = q.select("*").order("stage_order", { ascending: true }).order("created_at", { ascending: false }).limit(opts.limit ?? 500);
    if (opts.stageType) s = s.eq("stage_type", opts.stageType);
    return s;
  })
);

export const getClientOpportunities = cache(async (clientId: string) =>
  table<OpportunityRow>("v_crm_opportunities", (q) => q.select("*").eq("client_id", clientId).order("created_at", { ascending: false }))
);

export const getStages = cache(async () => table<Stage>("crm_stages", (q) => q.select("*").order("sort_order")));
export const getSettings = cache(async () => table<CrmSetting>("crm_settings", (q) => q.select("*").order("key")));
export const getLostReasons = cache(async () => table<LostReason>("crm_lost_reasons", (q) => q.select("*").order("sort_order")));
export const getSources = cache(async () => table<Source>("crm_sources", (q) => q.select("*").order("sort_order").order("name")));
export const getScoreRules = cache(async () => table<ScoreRule>("crm_score_rules", (q) => q.select("*").order("sort_order")));

export const getDuplicates = cache(async () =>
  table<DuplicatePair>("client_duplicates", (q) =>
    q.select("*, a:clients!client_duplicates_client_a_fkey(id,name,phone,stage,owner_id,created_at), b:clients!client_duplicates_client_b_fkey(id,name,phone,stage,owner_id,created_at)")
      .eq("status", "جديد")
      .order("match_type")
      .order("detected_at", { ascending: false })
      .limit(200)
  )
);

export const getLeadScore = cache(async (clientId: string): Promise<LeadScore | null> => {
  const m = await getLeadScores([clientId]);
  return m.get(clientId) ?? null;
});

export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-US");
}

// ============================================================
// ملف العميل ٣٦٠ — ما يقرأه رأس الملف وتبويباته (072 · 074 · 071).
// ============================================================

export type ClientAssignment = {
  id: string;
  client_id: string;
  from_owner_id: string | null;
  to_owner_id: string | null;
  from_owner_name: string | null;
  to_owner_name: string | null;
  reason: string | null;
  method: string;
  assigned_by_name: string | null;
  at: string;
};

export type OppStageHistory = {
  id: string;
  opportunity_id: string;
  from_stage: string | null;
  to_stage: string | null;
  days_in_from: number | null;
  changed_by_name: string | null;
  note: string | null;
  at: string;
};

export type ClientInterest = {
  id: string;
  created_at: string;
  client_id: string;
  opportunity_id: string | null;
  project_id: string | null;
  unit_id: string | null;
  unit_type: string | null;
  area_min: number | null;
  area_max: number | null;
  rooms: number | null;
  floor_pref: string | null;
  view_pref: string | null;
  budget_min: number | null;
  budget_max: number | null;
  payment_method: string | null;
  purpose: string | null;
  priority: number;
  status: string;
  notes: string | null;
  projects?: { name: string } | null;
  units?: { unit_code: string | null } | null;
};

export type ProjectLite = { id: string; name: string };

// التأهيل نصٌّ واحد من دالة واحدة (074) — لا يُعاد اشتقاقه هنا
export const getQualification = cache(async (clientId: string): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("client_qualification", { p_client_id: clientId });
  if (error) {
    console.error("[crm] فشل استدعاء client_qualification:", error.message);
    return null;
  }
  return (data as string | null) ?? null;
});

export const getClientAssignments = cache(async (clientId: string) =>
  table<ClientAssignment>("client_assignments", (q) =>
    q.select("*").eq("client_id", clientId).order("at", { ascending: false }).limit(50)
  )
);

export const getClientStageHistory = cache(async (clientId: string) =>
  table<OppStageHistory>("opportunity_stage_history", (q) =>
    q
      .select("*, opportunities!inner(client_id)")
      .eq("opportunities.client_id", clientId)
      .order("at", { ascending: false })
      .limit(100)
  )
);

export const getClientInterests = cache(async (clientId: string) =>
  table<ClientInterest>("client_interests", (q) =>
    q
      .select("*, projects(name), units(unit_code)")
      .eq("client_id", clientId)
      .order("priority")
      .order("created_at", { ascending: false })
  )
);

export const getProjectsLite = cache(async () =>
  table<ProjectLite>("projects", (q) => q.select("id,name").order("name"))
);

export const getOwnerName = cache(async (ownerId: string | null | undefined): Promise<string | null> => {
  if (!ownerId) return null;
  const rows = await table<{ full_name: string }>("employees", (q) => q.select("full_name").eq("id", ownerId).limit(1));
  return rows[0]?.full_name ?? null;
});

// ===== الاتجاهات والحملات والتنبؤ بالبُعد (076 · 078 · 079) =====

export type TrendPoint = { taken_on: string; value: number };

export type CampaignRow = {
  campaign_id: string;
  campaign_name: string;
  medium: string | null;
  budget: number | null;
  spent: number | null;
  leads: number;
  qualified: number;
  opportunities: number;
  reservations: number;
  won: number;
  revenue: number;
  cost_per_lead: number | null;
  cost_per_qualified: number | null;
  cac: number | null;
  roi_pct: number | null;
};

export type ForecastByRow = {
  dimension_id: string | null;
  dimension_name: string;
  open_count: number;
  pipeline_value: number;
  weighted_value: number;
  commit_value: number;
  avg_probability: number;
};

export type TrendMetric =
  | "leads" | "opportunities" | "open_count" | "won_count" | "lost_count"
  | "conversion_rate" | "pipeline_value" | "weighted_pipeline" | "won_value"
  | "avg_cycle_days" | "overdue_count" | "neglected_count";

// الاتجاه يُقرأ من اللقطات اليومية (crm_snapshots) — لا يُعاد حسابه
// من الحالة الراهنة، فالسؤال «كيف كان الأسبوع الماضي؟» لا يُجاب من اليوم.
export const getTrend = cache(async (metric: TrendMetric, days = 30) =>
  rpc<TrendPoint>("crm_trend", { p_metric: metric, p_days: days, p_scope: "كلي", p_scope_id: null })
);

export const getCampaignPerformance = cache(async (f: CrmFilters = {}) =>
  rpc<CampaignRow>("crm_campaign_performance", { p_from: f.from ?? null, p_to: f.to ?? null })
);

export const getForecastBy = cache(async (dimension: "موظف" | "مشروع" | "مصدر" | "فريق") =>
  rpc<ForecastByRow>("crm_forecast_by", { p_dimension: dimension })
);

// ===== العروض المحفوظة (080) — عروضي والمشترك معي =====
export type SavedViewRow = {
  id: string;
  user_id: string;
  name: string;
  entity: string;
  filters: Record<string, string>;
  is_shared: boolean;
  is_default: boolean;
};

export const getSavedViews = cache(async (entity: "clients" | "opportunities") =>
  table<SavedViewRow>("crm_saved_views", (q) =>
    q.select("id,user_id,name,entity,filters,is_shared,is_default").eq("entity", entity).order("sort_order").order("name")
  )
);
