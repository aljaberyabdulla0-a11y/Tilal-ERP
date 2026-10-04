import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { MktFilters } from "@/lib/marketing-filters";

// ============================================================
// طبقة الوصول إلى قسم التسويق (sql/121–126).
//
// ⚠️ **لا حساب هنا** — نفس مبدأ src/lib/crm.ts. كل رقم يأتي من دالّة
//    في القاعدة (125) كما هو. أي map يغيّر رقماً هنا يُعيد علّة
//    «الرقم الواحد في مكانين بطريقتين».
//
// والأخطاء تُبتلع مع طباعتها: صفحةٌ تعرض «غير متاح» أهون من صفحة
// تسقط لأن هجرةً لم تُطبَّق بعد. والشاشة تفرّق بين الفارغ والمتعذّر.
// ============================================================

export type RpcResult<T> = { data: T; error: string | null };

async function rpcOne<T>(fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[marketing] ${fn}:`, error.message);
    return { data: null, error: error.message };
  }
  return { data: (data ?? null) as T | null, error: null };
}

async function rpcRows<T>(fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[marketing] ${fn}:`, error.message);
    return { data: [], error: error.message };
  }
  return { data: (data ?? []) as T[], error: null };
}

function f2args(f: Pick<MktFilters, "from" | "to" | "project" | "campaign" | "channel">) {
  return {
    p_from: f.from, p_to: f.to,
    p_project: f.project, p_campaign: f.campaign, p_channel: f.channel,
  };
}

// ===== الأنواع — مطابقة لمخرجات 125 =====

export type Kpis = {
  model: string;
  cost: number; spend: number; materials: number; ad_spend: number; committed: number;
  platform_spend: number; recon_gap: number;
  impressions: number; reach: number; clicks: number; link_clicks: number; platform_leads: number;
  video_views: number; engagements: number; visitors: number; scans: number;
  leads: number; qualified: number; contacted: number; visited: number; offered: number;
  reservations: number; cohort_sales: number;
  sales: number; commission: number; sale_value: number;
  cpl: number | null; cpql: number | null; cpa: number | null; cac: number | null;
  ctr: number | null; cpc: number | null;
  lead_to_qualified: number | null; lead_to_reservation: number | null; lead_to_sale: number | null;
  roas: number | null; roi: number | null; roi_value: number | null;
};

export type BreakdownRow = {
  dim_key: string | null; label: string;
  cost: number; ad_spend: number; platform_spend: number; impressions: number; clicks: number;
  leads: number; qualified: number; reservations: number;
  sales: number; commission: number; sale_value: number;
  cpl: number | null; cpql: number | null; cac: number | null; roas: number | null; roi: number | null;
};

export type FunnelRow = { step: number; code: string; label: string; value: number; from_previous: number | null; from_leads: number | null };
export type TrendRow = { period: string; cost: number; leads: number; qualified: number; sales: number; commission: number };

export type BudgetStatus = {
  budget_id: string; name: string; scope: string; scope_label: string; period_type: string;
  period_start: string; period_end: string; status: string;
  planned: number; approved: number | null; committed: number; spent: number; remaining: number;
  utilization_pct: number | null; alert_level: string | null; forecast: number | null;
};

export type QualityRow = { code: string; severity: string; label: string; n: number; hint: string; sample: unknown };
export type SearchRow = { kind: string; id: string; title: string; subtitle: string | null; href: string };
export type CalendarItem = { kind: string; id: string; title: string; starts: string; ends: string; status: string; href: string };
export type ObjectiveProgress = {
  objective_id: string; title: string; kind: string; metric_code: string | null;
  target_value: number | null; actual: number | null; progress_pct: number | null; on_track: boolean | null;
};
export type Forecast = {
  ok: boolean; reason?: string; months?: number; monthly_budget?: number;
  basis: Record<string, number | string | null>;
  scenarios?: { scenario: string; cost: number; leads: number; qualified: number; reservations: number; sales: number; commission: number | null; roi: number | null }[];
};

export type Person = { id: string; full_name: string; job_title: string | null; mkt_role: string | null; user_id: string | null };
export type ProjectLite = { id: string; name: string; status: string | null; governorate: string | null };
export type Channel = {
  id: string; name: string; mode: string; platform: string | null; source_id: string | null;
  utm_source: string; utm_medium: string; owner_employee_id: string | null; vendor_id: string | null;
  monthly_budget: number | null; is_active: boolean; sort_order: number;
};

export type Campaign = {
  id: string; name: string; code: string; campaign_type: string; status: string; mode: string;
  objective: string | null; project_id: string | null; channel_id: string | null; audience_id: string | null;
  plan_id: string | null; owner_employee_id: string | null; unit_type: string | null; unit_id: string | null;
  start_date: string | null; end_date: string | null; budget: number | null; spent: number | null;
  expected_leads: number | null; expected_qualified: number | null; expected_reservations: number | null;
  expected_sales: number | null; expected_revenue: number | null; target_cpl: number | null;
  is_active: boolean; notes: string | null; approved_at: string | null; created_at: string;
  source_id: string | null; medium: string | null; content: string | null;
};

export type Approval = {
  id: string; entity_type: string; entity_id: string; title: string; amount: number | null;
  approver: string; escalated_reason: string | null; status: string; note: string | null;
  requested_by: string | null; requested_by_name: string | null; requested_at: string;
  decided_by_name: string | null; decided_at: string | null; reason: string | null;
};

export type Alert = {
  id: string; rule_code: string | null; entity_type: string | null; entity_id: string | null;
  severity: string; title: string; body: string | null; link: string | null;
  notified: number; created_at: string; resolved_at: string | null;
};

// ===== المؤشّرات والتحليل (125) =====

export const getKpis = cache(async (f: MktFilters): Promise<RpcResult<Kpis | null>> =>
  rpcOne<Kpis>("mkt_kpis", { ...f2args(f), p_model: f.model })
);

export async function getKpisFor(
  range: { from: string | null; to: string | null },
  f: Partial<MktFilters> = {}
): Promise<Kpis | null> {
  const r = await rpcOne<Kpis>("mkt_kpis", {
    p_from: range.from, p_to: range.to,
    p_project: f.project ?? null, p_campaign: f.campaign ?? null, p_channel: f.channel ?? null,
    p_model: f.model ?? "last",
  });
  return r.data;
}

export const getBreakdown = cache(async (dim: string, f: MktFilters) =>
  rpcRows<BreakdownRow>("mkt_breakdown", { p_dim: dim, ...f2args(f), p_model: f.model })
);

export const getFunnel = cache(async (f: MktFilters) => rpcRows<FunnelRow>("mkt_funnel", f2args(f)));

export const getTrend = cache(async (grain: "day" | "week" | "month", f: MktFilters) =>
  rpcRows<TrendRow>("mkt_trend", { p_grain: grain, ...f2args(f) })
);

export const getForecast = cache(async (monthlyBudget: number, months: number, project: string | null, channel: string | null) =>
  rpcOne<Forecast>("mkt_forecast", {
    p_monthly_budget: monthlyBudget, p_months: months, p_project: project, p_channel: channel,
  })
);

export const getBudgetStatus = cache(async (from: string | null = null, to: string | null = null) =>
  rpcRows<BudgetStatus>("mkt_budget_status", { p_from: from, p_to: to })
);

export const getDataQuality = cache(async () => rpcRows<QualityRow>("mkt_data_quality"));
export const searchMarketing = cache(async (q: string) => rpcRows<SearchRow>("mkt_search", { p_q: q, p_limit: 40 }));
export const getCalendar = cache(async (from: string, to: string) =>
  rpcRows<CalendarItem>("mkt_calendar", { p_from: from, p_to: to })
);
export const getObjectiveProgress = cache(async (planId: string) =>
  rpcRows<ObjectiveProgress>("mkt_objective_progress", { p_plan: planId })
);
export const getProjectOverview = cache(async (projectId: string, from: string | null, to: string | null) =>
  rpcOne<Record<string, unknown>>("mkt_project_overview", { p_project: projectId, p_from: from, p_to: to })
);

// ===== القوائم المرجعية =====

export const getPeople = cache(async () => (await rpcRows<Person>("mkt_people")).data);
export const getMktProjects = cache(async () => (await rpcRows<ProjectLite>("mkt_projects")).data);
export const getUnits = cache(async (projectId: string) =>
  (await rpcRows<{ id: string; unit_code: string; unit_type: string | null; status: string; space_m2: number | null; price: number | null; node_path: string | null }>(
    "mkt_units", { p_project: projectId })).data
);

async function table<T>(name: string, build: (q: any) => any): Promise<T[]> {
  const supabase = await createClient();
  const { data, error } = await build(supabase.from(name));
  if (error) {
    console.error(`[marketing] ${name}:`, error.message);
    return [];
  }
  return (data ?? []) as T[];
}

export const getChannels = cache(async () =>
  table<Channel>("mkt_channels", (q) => q.select("*").order("sort_order").order("name"))
);

export const getCampaignsLite = cache(async () =>
  table<Pick<Campaign, "id" | "name" | "code" | "status" | "project_id" | "channel_id" | "is_active">>(
    "crm_campaigns", (q) => q.select("id, name, code, status, project_id, channel_id, is_active").order("created_at", { ascending: false }))
);

export const getCampaign = cache(async (id: string): Promise<Campaign | null> => {
  const rows = await table<Campaign>("crm_campaigns", (q) => q.select("*").eq("id", id).limit(1));
  return rows[0] ?? null;
});

export const getAudiences = cache(async () =>
  table<{ id: string; name: string; segment: string | null; description: string | null; project_id: string | null; is_active: boolean }>(
    "mkt_audiences", (q) => q.select("*").order("name"))
);

export const getMarketingVendors = cache(async () =>
  table<{ id: string; name: string; phone: string | null; email: string | null; contact_person: string | null; services: string[]; rating: number | null; is_active: boolean; notes: string | null; contract_notes: string | null }>(
    "suppliers", (q) => q.select("id, name, phone, email, contact_person, services, rating, is_active, notes, contract_notes").eq("is_marketing", true).order("name"))
);

export const getApprovals = cache(async (status: string | null = "معلّق") =>
  table<Approval>("mkt_approvals", (q) => {
    let x = q.select("*").order("requested_at", { ascending: false }).limit(200);
    if (status) x = x.eq("status", status);
    return x;
  })
);

export const getEntityApprovals = cache(async (entityType: string, entityId: string) =>
  table<Approval>("mkt_approvals", (q) =>
    q.select("*").eq("entity_type", entityType).eq("entity_id", entityId).order("requested_at", { ascending: false }))
);

export const getOpenAlerts = cache(async (limit = 50) =>
  table<Alert>("mkt_alerts", (q) => q.select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(limit))
);

/** أسماء الأشخاص بمعرّفاتهم — للعرض فقط */
export function peopleMap(people: Person[]): Map<string, string> {
  return new Map(people.map((p) => [p.id, p.full_name]));
}
