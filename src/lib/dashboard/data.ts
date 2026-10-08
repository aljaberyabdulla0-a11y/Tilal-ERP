import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { reportQuery, stateModeFor } from "@/lib/crm-reporting";
import type { EngineRow } from "@/lib/report-engine";
import { bucketKeys, type DateRange } from "@/lib/report-dates";
import { toMoneyOverview, type MoneyOverview, type RawOverview } from "@/lib/money-overview";
import type { Grain } from "./period";

// ============================================================
// طبقة بيانات اللوحات — نقلٌ لا حساب.
//
// ⚠️ لا تجميع لجداول كاملة هنا. كل رقم يأتي محسوباً من القاعدة:
//    • المبيعات والـCRM  ← crm_report_query (096–102) بسجلّ crm_metrics
//    • المال            ← money_overview و account_balances (112) — نفس
//                          مصدر صفحة المالية، فلا يرى المدير رقمين
//    • المخزون والنشاط والتنبيهات وملخّصي ← dashboard_* (182)
//    • الوساطة والتسويق وHR ← دوالّ وحداتها (130، 125، 165)
//
// كل دالّة تُرجع Result: نجاحٌ ببياناته أو فشلٌ برسالته. القسم الذي
// يفشل يعرض «تعذّر تحميل هذا القسم» ولا يُسقط اللوحة — ولا يعرض
// صفراً كأنه حقيقة.
// ============================================================

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = <T,>(error: string): Result<T> => ({ ok: false, error });

async function guard<T>(label: string, fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[dashboard] ${label}:`, msg);
    return fail(msg);
  }
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  return guard(fn, async () => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      console.error(`[dashboard] ${fn}:`, error.message);
      return fail(error.message);
    }
    return ok(data as T);
  });
}

// ===== محرّك التقارير =====

export type Totals = Record<string, number | null>;

// مجاميع الفترة لمقاييس عدّة في رحلة واحدة (بلا تجزئة)
export async function engineTotals(
  metrics: string[], range: DateRange, filters: Record<string, unknown>, today: string
): Promise<Result<Totals>> {
  return guard("engineTotals", async () => {
    const r = await reportQuery({
      metrics, range, filters, basis: "event", state: stateModeFor(range, today),
    });
    if (r.error) return fail(r.error);
    return ok(r.rows[0]?.metrics ?? {});
  });
}

// الفترة الحالية والسابقة معاً — بالتوازي
export async function engineCompare(
  metrics: string[], range: DateRange, previous: DateRange | null,
  filters: Record<string, unknown>, today: string
): Promise<Result<{ cur: Totals; prev: Totals | null }>> {
  const [cur, prev] = await Promise.all([
    engineTotals(metrics, range, filters, today),
    previous ? engineTotals(metrics, previous, filters, today) : Promise.resolve(null),
  ]);
  if (!cur.ok) return cur;
  return ok({ cur: cur.data, prev: prev && prev.ok ? prev.data : null });
}

// سلسلة زمنية مملوءة بأصفار للأيام الصامتة (المحرّك لا يُرجع بُعداً بلا حدث)
export async function engineSeries(
  metrics: string[], range: DateRange, filters: Record<string, unknown>,
  grain: Grain, today: string, weekStartDow = 6
): Promise<Result<{ key: string; metrics: Totals }[]>> {
  return guard("engineSeries", async () => {
    const r = await reportQuery({
      metrics, groupBy: [grain], range, filters, basis: "event", state: stateModeFor(range, today),
    });
    if (r.error) return fail(r.error);
    const idx = new Map(r.rows.map((row) => [row.dims[grain] ?? "", row.metrics]));
    return ok(bucketKeys(range, grain, weekStartDow).map((k) => ({ key: k, metrics: idx.get(k) ?? {} })));
  });
}

// تجزئة على بُعدٍ واحد (مشروع، مصدر، سبب خسارة…)
export async function engineBy(
  metrics: string[], dim: string, range: DateRange, filters: Record<string, unknown>, today: string
): Promise<Result<EngineRow[]>> {
  return guard("engineBy", async () => {
    const r = await reportQuery({
      metrics, groupBy: [dim], range, filters, basis: "event", state: stateModeFor(range, today),
    });
    if (r.error) return fail(r.error);
    return ok(r.rows);
  });
}

// ===== المال (112) =====

export const getMoney = cache(async (today: string): Promise<Result<MoneyOverview>> => {
  const r = await rpc<RawOverview>("money_overview", { p_today: today });
  return r.ok ? ok(toMoneyOverview(r.data ?? {})) : r;
});

export type PeriodPnl = { income: number; expense: number; net: number };

// الدخل والصرف لفترة من ميزان الحسابات — هو نفسه مصدر «قائمة الدخل».
// الصفوف حسابات الدليل (عشرات) لا قيود، فالجمع هنا لا يقترب من حدّ ١٠٠٠.
export async function getPeriodPnl(range: DateRange): Promise<Result<PeriodPnl>> {
  const r = await rpc<{ type: string; debit: number; credit: number }[]>("account_balances", {
    p_from: range.from, p_to: range.to,
  });
  if (!r.ok) return r;
  let income = 0, expense = 0;
  for (const a of r.data ?? []) {
    if (a.type === "revenue") income += Number(a.credit) - Number(a.debit);
    else if (a.type === "expense") expense += Number(a.debit) - Number(a.credit);
  }
  return ok({ income, expense, net: income - expense });
}

// ===== لوحة التحكم (182) =====

export type UnitsRow = {
  project_id: string | null; project_name: string;
  total: number; available: number; reserved: number; sold: number; blocked: number;
  active_reservations: number; available_value: number; sold_list_value: number;
};

export const getUnits = cache(async (projectId: string | null): Promise<Result<UnitsRow[]>> => {
  const r = await rpc<UnitsRow[]>("dashboard_units", { p_project_id: projectId });
  if (!r.ok) return r;
  return ok((r.data ?? []).map((u) => ({
    ...u,
    total: Number(u.total), available: Number(u.available), reserved: Number(u.reserved),
    sold: Number(u.sold), blocked: Number(u.blocked), active_reservations: Number(u.active_reservations),
    available_value: Number(u.available_value), sold_list_value: Number(u.sold_list_value),
  })));
});

export type ActivityRow = {
  at: string; kind: string; subtype: string;
  entity: string; entity_id: string | null;
  client_id: string | null; client_name: string | null;
  project_id: string | null; project_name: string | null;
  actor_name: string | null; amount: number | null; detail: string | null;
};

export async function getActivity(limit: number, projectId: string | null): Promise<Result<ActivityRow[]>> {
  return rpc<ActivityRow[]>("dashboard_activity", { p_limit: limit, p_project_id: projectId, p_before: null });
}

export type Attention = {
  sale_requests_pending: number; reservations_expiring: number; reservations_expired: number;
  broker_requests_open: number; broker_requests_supervisor: number; broker_leads_expiring: number;
  approvals_pending: number; leaves_pending: number; inventory_low: number; tasks_overdue: number;
};

export const getAttention = cache(async (projectId: string | null): Promise<Result<Attention>> =>
  rpc<Attention>("dashboard_attention", { p_project_id: projectId })
);

export type MySummary = {
  has_employee: boolean;
  leads_open: number; leads_total: number; leads_hot: number; leads_new_month: number; followups_due: number;
  reservations_active: number; sales_month: number; sales_total: number;
  tasks_open: number; tasks_overdue: number; tasks_today: number; tasks_done_today: number;
  commission_total: number; commission_month: number; commission_unpaid: number;
};

export const getMySummary = cache(async (): Promise<Result<MySummary>> => rpc<MySummary>("dashboard_my_summary"));

// ===== قوائم المُرشِّحات (RLS تحدّد ما يُعرض) =====

export type Option = { id: string; name: string };

export const getProjectOptions = cache(async (): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("id, name").order("name");
  return (data ?? []) as Option[];
});

export const getSourceOptions = cache(async (): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("crm_sources").select("id, name").eq("is_active", true).order("sort_order");
  return (data ?? []) as Option[];
});

// ===== الوساطة (130) =====

export type BrokerPerfRow = {
  company_id: string; company_name: string; is_active: boolean;
  leads: number; requests: number; reservations: number; sales: number;
  conversion_rate: number | null; sales_value: number; commission: number; rank: number;
};

export async function getBrokerPerformance(range: DateRange, projectId: string | null): Promise<Result<BrokerPerfRow[]>> {
  return rpc<BrokerPerfRow[]>("broker_performance", { p_from: range.from, p_to: range.to, p_project: projectId });
}
