import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Insight } from "@/lib/lost-sales-i18n";

// ============================================================
// طبقة الوصول إلى تحليل الخسائر (sql/140–141).
//
// نفس مبدأ crm.ts: **لا حساب هنا**. المؤشّرات والتفصيل والرؤى تأتي من
// crm_lost_intelligence محسوبةً بصلاحية القارئ (RLS)، وهذه الدوال نقلٌ
// فقط. والخطأ يُبتلع ويُسجَّل فتعرض الشاشة «غير متاح» لا صفحة معطوبة.
// ============================================================

export type LossCategory = {
  id: string; code: string; name_ar: string; name_en: string;
  default_source: string | null; requires_competitor: boolean; is_active: boolean; sort_order: number;
};
export type LossReason = {
  id: string; category_id: string | null; name: string; name_en: string | null;
  requires_note: boolean; is_other: boolean; is_active: boolean; sort_order: number;
};
export type LossSource = { code: string; name_ar: string; name_en: string; is_active: boolean; sort_order: number };
export type CustomerPotential = LossSource & { is_qualified: boolean };
export type RecoveryLevel = LossSource & {
  is_recoverable: boolean; allows_recontact: boolean; recontact_required: boolean; recontact_days: number | null;
};
export type Competitor = { id: string; name: string; name_en: string | null; is_active: boolean; projects: string | null; price_position: string | null };
export type CompetitorProject = {
  id: string; competitor_id: string; name: string; location: string | null; price_per_m2: number | null;
  payment_plan: string | null; is_active: boolean;
};

export type LossLookups = {
  categories: LossCategory[];
  reasons: LossReason[];
  sources: LossSource[];
  potentials: CustomerPotential[];
  recovery: RecoveryLevel[];
  competitors: Competitor[];
  competitorProjects: CompetitorProject[];
};

export type LostSaleRow = {
  id: string; opportunity_id: string; loss_no: number; lost_at: string; lost_by_name: string | null;
  is_backfilled: boolean; owner_id: string | null; owner_name: string | null; manager_name: string | null;
  project_id: string | null; project_name: string | null; unit_code: string | null;
  source_name: string | null; campaign_name: string | null;
  lost_stage_name: string | null; furthest_milestone: string | null;
  days_in_pipeline: number | null; days_in_stage: number | null;
  unit_type: string | null; area_m2: number | null; price_per_m2: number | null; unit_price: number | null;
  discount: number | null; lost_value: number | null; value_basis: string; payment_plan: string | null;
  expected_revenue: number | null; expected_commission: number | null;
  category_id: string | null; category_code: string | null; category_name_ar: string | null; category_name_en: string | null;
  reason_id: string | null; reason_name_ar: string | null; reason_name_en: string | null;
  loss_source: string | null; loss_source_name_ar: string | null; loss_source_name_en: string | null;
  customer_potential: string | null; customer_potential_name_ar: string | null; customer_potential_name_en: string | null;
  recovery_potential: string | null; recovery_name_ar: string | null; recovery_name_en: string | null; is_recoverable: boolean;
  recontact_required: boolean; recontact_date: string | null; recovery_reason: string | null; details: string | null;
  competitor_id: string | null; competitor_project_id: string | null; competitor_name: string | null;
  competitor_display_name: string | null; competitor_project_name: string | null;
  competitor_price: number | null; competitor_price_per_m2: number | null; competitor_unit_m2: number | null;
  competitor_payment_plan: string | null; competitor_advantage: string | null; competitor_choice_reason: string | null;
  contacts_count: number | null; meetings_count: number | null; visits_count: number | null; offers_count: number | null;
  last_contact_at: string | null; recontact_task_id: string | null;
  outcome: "lost" | "reactivated" | "recovered" | "relost";
  reactivated_at: string | null; reactivated_by_name: string | null; reactivation_note: string | null;
  closed_after_at: string | null; recovered_value: number | null;
  review_status: "pending" | "confirmed" | "disputed"; reviewed_by_name: string | null; reviewed_at: string | null; review_note: string | null;
  client_id: string; client_name: string; opportunity_title: string | null;
  current_stage_name: string; current_stage_type: string; needs_analysis: boolean; days_since_lost: number;
  updated_at: string; updated_by_name: string | null;
};

export type LostChange = {
  id: number; lost_sale_id: string; field: string; old_value: string | null; new_value: string | null;
  edit_reason: string | null; changed_by_name: string | null; changed_at: string;
};

// ——— أنواع ناتج crm_lost_intelligence ———
export type DimRow = {
  key: string | null; label: string | null; total: number; won: number; lost: number; open: number;
  won_value: number; lost_value: number; win_rate: number | null; lost_rate: number | null;
  recoverable: number; recoverable_value: number; recovered: number; recovery_rate: number | null;
  price_lost: number; unqualified_lost: number; sales_employee_lost: number; main_category: string | null;
  leads?: number; qualified?: number; qualified_rate?: number | null; opp_per_lead?: number | null;
};
export type ShareRow = { code: string; n: number; value: number; share?: number | null };
export type LostIntelligence = {
  filters: Record<string, string>;
  period: { from: string | null; to: string | null; trend_from: string; trend_to: string };
  kpis: {
    total: number; won: number; lost: number; open: number;
    won_value: number; lost_value: number; open_value: number;
    win_rate: number | null; lost_rate: number | null;
    recoverable_count: number; recoverable_value: number; high_recovery_count: number;
    recovered_count: number; recovered_value: number; unanalysed: number; unqualified_lost: number;
    lost_without_value: number; lost_value_estimated: number;
  };
  by_category: (ShareRow & { recoverable: number; high_recovery: number; top_reason_ar: string | null; top_reason_en: string | null })[];
  by_reason: { code: string | null; name_ar: string; name_en: string; n: number; value: number; share: number | null }[];
  by_loss_source: ShareRow[];
  by_potential: ShareRow[];
  by_recovery: ShareRow[];
  by_stage: { stage: string; ord: number | null; n: number; value: number; share: number | null; main_category: string | null }[];
  by_milestone: ShareRow[];
  by_project: DimRow[];
  by_employee: DimRow[];
  by_price_band: DimRow[];
  by_unit_size: DimRow[];
  by_source: DimRow[];
  by_campaign: DimRow[];
  by_competitor: {
    key: string; name: string; n: number; value: number; main_reason_ar: string | null; main_reason_en: string | null;
    avg_m2_diff: number | null; avg_price_diff: number | null; payment_plans: string | null; projects: string | null;
  }[];
  recoverable: {
    opportunity_id: string; loss_id: string; client_name: string; project_name: string | null; value: number | null;
    cat_code: string | null; rsn_ar: string | null; rsn_en: string | null; recovery_potential: string;
    owner_name: string | null; last_activity_at: string | null; recontact_date: string | null; days_since_lost: number;
  }[];
  monthly: {
    m: string; won: number; lost: number; lost_rate: number | null; won_value: number; lost_value: number;
    top_category: string | null; top_project: string | null; top_competitor: string | null;
  }[];
  reason_trend: { m: string; code: string; n: number }[];
  insights: Insight[];
  generated_at: string;
};

export type ClientSalesHistory = {
  total: number; won: number; lost: number; open: number;
  won_value: number; lost_value: number; recovered: number; recovered_value: number;
  opportunities: { id: string; title: string; stage_name: string; stage_type: string; value: number | null;
                   created_at: string; closed_at: string | null; losses: number; reactivated: boolean }[];
  losses: { id: string; opportunity_id: string; lost_at: string; loss_no: number; category_code: string;
            category_name_ar: string | null; category_name_en: string | null;
            reason_name_ar: string | null; reason_name_en: string | null; lost_stage_name: string | null;
            lost_value: number | null; outcome: string; project_name: string | null; competitor: string | null }[];
};

async function rows<T>(name: string, build: (q: any) => any): Promise<T[]> {
  const supabase = await createClient();
  const { data, error } = await build(supabase.from(name));
  if (error) {
    console.error(`[lost-sales] فشل قراءة ${name}:`, error.message);
    return [];
  }
  return (data ?? []) as T[];
}

export const getLossLookups = cache(async (): Promise<LossLookups> => {
  const [categories, reasons, sources, potentials, recovery, competitors, competitorProjects] = await Promise.all([
    rows<LossCategory>("crm_loss_categories", (q) => q.select("*").order("sort_order")),
    rows<LossReason>("crm_lost_reasons", (q) =>
      q.select("id, category_id, name, name_en, requires_note, is_other, is_active, sort_order").order("sort_order")),
    rows<LossSource>("crm_loss_sources", (q) => q.select("*").order("sort_order")),
    rows<CustomerPotential>("crm_customer_potentials", (q) => q.select("*").order("sort_order")),
    rows<RecoveryLevel>("crm_recovery_levels", (q) => q.select("*").order("sort_order")),
    rows<Competitor>("mkt_competitors", (q) => q.select("id, name, name_en, is_active, projects, price_position").order("name")),
    rows<CompetitorProject>("mkt_competitor_projects", (q) =>
      q.select("id, competitor_id, name, location, price_per_m2, payment_plan, is_active").order("name")),
  ]);
  return { categories, reasons, sources, potentials, recovery, competitors, competitorProjects };
});

export const getLostIntelligence = cache(async (filters: Record<string, string>): Promise<LostIntelligence | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_lost_intelligence", { p_filters: filters });
  if (error) {
    console.error("[lost-sales] crm_lost_intelligence:", error.message);
    return null;
  }
  return data as LostIntelligence;
});

export const getOpportunityLosses = cache(async (opportunityId: string) =>
  rows<LostSaleRow>("v_crm_lost_sales", (q) =>
    q.select("*").eq("opportunity_id", opportunityId).order("loss_no", { ascending: false }))
);

export const getLostChanges = cache(async (opportunityId: string) =>
  rows<LostChange>("crm_lost_sale_changes", (q) =>
    q.select("*").eq("opportunity_id", opportunityId).order("changed_at", { ascending: false }).limit(200))
);

export const getClientSalesHistory = cache(async (clientId: string): Promise<ClientSalesHistory | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_client_sales_history", { p_client_id: clientId });
  if (error) {
    console.error("[lost-sales] crm_client_sales_history:", error.message);
    return null;
  }
  return data as ClientSalesHistory;
});

// إعادة التواصل المستحقّة: RLS تحصر النطاق (الموظف خسائره، المشرف فريقه).
// الموظف يرى ما يخصّه هو فقط حين يمرّر معرّفه.
export const getDueRecontacts = cache(async (ownerEmployeeId: string | null, withinDays = 7) => {
  const until = new Date(Date.now() + withinDays * 86400000).toISOString().slice(0, 10);
  return rows<LostSaleRow>("v_crm_lost_sales", (q) => {
    let s = q.select("*").eq("outcome", "lost").eq("recontact_required", true)
      .lte("recontact_date", until).order("recontact_date", { ascending: true }).limit(50);
    if (ownerEmployeeId) s = s.eq("owner_id", ownerEmployeeId);
    return s;
  });
});

export type OppDetail = {
  id: string; client_id: string; client_name: string; owner_id: string | null; owner_name: string | null;
  project_id: string | null; project_name: string | null; unit_id: string | null; source_name: string | null;
  campaign_id: string | null; client_campaign_id: string | null; stage_id: string; stage_name: string;
  stage_type: "open" | "won" | "lost"; probability: number | null; expected_value: number | null;
  won_value: number | null; lost_reason: string | null; created_at: string; closed_at: string | null;
  expected_close_date: string | null; next_action_date: string | null; days_in_stage: number; days_open: number;
  days_silent: number; lead_temperature: string | null; lead_score: number | null;
};

export const getOpportunityDetail = cache(async (id: string): Promise<OppDetail | null> => {
  const r = await rows<OppDetail>("v_crm_opportunities", (q) => q.select("*").eq("id", id).limit(1));
  return r[0] ?? null;
});

export type OppTimelineItem = {
  at: string; kind: "created" | "stage" | "lost" | "reactivated" | "recovered" | "activity";
  title: string; detail: string | null; actor: string | null;
};

export const getOpportunityExtras = cache(async (id: string) => {
  const supabase = await createClient();
  const [{ data: opp }, { data: history }, { data: acts }] = await Promise.all([
    supabase.from("opportunities")
      .select("id, title, created_at, created_by_name, unit_id, campaign_id, payment_method, budget_min, budget_max, notes, next_action, units(unit_code, space_m2, price, unit_type), crm_campaigns(name)")
      .eq("id", id).maybeSingle(),
    supabase.from("opportunity_stage_history")
      .select("from_stage, to_stage, days_in_from, changed_by_name, note, at")
      .eq("opportunity_id", id).order("at", { ascending: true }),
    supabase.from("client_activities")
      .select("activity_type, summary, actor_name, occurred_at, next_action, next_action_date")
      .eq("opportunity_id", id).order("occurred_at", { ascending: true }).limit(200),
  ]);
  return {
    opp: opp as any,
    history: (history ?? []) as { from_stage: string | null; to_stage: string | null; days_in_from: number | null; changed_by_name: string | null; note: string | null; at: string }[],
    activities: (acts ?? []) as { activity_type: string; summary: string | null; actor_name: string | null; occurred_at: string; next_action: string | null; next_action_date: string | null }[],
  };
});
