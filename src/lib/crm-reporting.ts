import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  type EngineRow, type MetricDef, type Insight, type Matrix, type Movement, type FunnelStep,
  buildMatrix, changeInsight, compareValues, concentrationInsight, fillBuckets,
  funnelSteps, insightsFromTrend, pipelineMovement, sortRows, valueOf,
} from "@/lib/report-engine";
import { autoGrain, bucketKeys, type DateRange } from "@/lib/report-dates";
import {
  type ReportParams, type FilterKey, type FixedFilters, FILTER_LABELS, cleanFixedFilters, toEngineFilters, withFixedFilters,
} from "@/lib/report-filters";
import { getCampaignPerformance, type CampaignRow } from "@/lib/crm";

// ============================================================
// طبقة خدمة التقارير (§57) — بين المحرّك (097) والشاشات.
//
// ⚠️ لا حساب مقياسٍ هنا. كل رقم من crm_report_query، وهنا فقط:
//    أيّ استعلام لأيّ قسم، بأيّ مدى ومقارنة، ثم تركيب الناتج.
//
// والمجاميع تُطلب من المحرّك لا تُجمع هنا (report-engine.canSum):
// «عملاء فريدون» للفريق كله ليس مجموع عملاء أفراده.
//
// الأخطاء لا تُبتلع صامتةً كما في crm.ts: تقرير يقول «٠ تواصل» لأن
// الدالة فشلت يكذب. كل قسم يحمل خطأه فيُعرض مكانه، ويُسجَّل التشغيل
// «فشل» في سجلّ التشغيل (§40).
// ============================================================

// ===== الأنواع =====

export type SectionDef = {
  key: string;
  title: string;
  type: "kpis" | "trend" | "table" | "matrix" | "funnel" | "movement" | "insights" | "campaign_costs";
  metrics?: string[];
  group_by?: string[];
  sort?: string;
  state?: "snapshot" | "current";
};

export type ReportDefinition = {
  default_range?: string;
  compare?: string;
  basis?: string;
  link?: string;
  // نطاق ثابت يُفرض في كل توليد (تقرير مشروع بعينه) — انظر withFixedFilters
  filters?: Record<string, string[]>;
  sections: SectionDef[];
};

export type ReportTemplate = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  category: string;
  definition: ReportDefinition;
  audience: string[];
  is_system: boolean;
  is_shared: boolean;
  version: number;
  created_by: string | null;
  updated_at: string;
  sort_order: number;
};

export type SectionResult =
  | { type: "kpis"; def: SectionDef; metrics: MetricDef[]; current?: EngineRow; previous?: EngineRow; stateAt: string; error?: string }
  | { type: "trend"; def: SectionDef; metrics: MetricDef[]; grain: "day" | "week" | "month"; rows: EngineRow[]; error?: string }
  | { type: "table"; def: SectionDef; metrics: MetricDef[]; dims: string[]; rows: EngineRow[]; total?: EngineRow; previousTotal?: EngineRow; error?: string }
  | { type: "matrix"; def: SectionDef; metric: MetricDef; rowDim: string; colDim: string; matrix: Matrix; error?: string }
  | { type: "funnel"; def: SectionDef; metrics: MetricDef[]; steps: FunnelStep[]; previous: FunnelStep[] | null; error?: string }
  | { type: "movement"; def: SectionDef; movement: Movement; openingDate: string; closingAt: string; error?: string }
  | { type: "insights"; def: SectionDef; insights: Insight[]; error?: string }
  | { type: "campaign_costs"; def: SectionDef; rows: CampaignRow[]; error?: string };

export type GeneratedReport = {
  template: ReportTemplate;
  params: ReportParams;
  sections: SectionResult[];
  metricDefs: MetricDef[];
  labels: DimLabels;
  lastSnapshot: string | null;
  generatedAt: string;
  durationMs: number;
  rows: number;
  errors: string[];
};

export type DimLabels = Record<string, Map<string, string>>;

// ===== القراءة الأساسية =====

export const getMetricDefs = cache(async (): Promise<MetricDef[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("crm_metrics").select("*").eq("is_active", true).order("sort_order");
  if (error) {
    console.error("[reports] crm_metrics:", error.message);
    return [];
  }
  return (data ?? []) as MetricDef[];
});

export const getReportTemplates = cache(async (): Promise<ReportTemplate[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("crm_report_templates").select("*").eq("is_active", true).order("sort_order").order("name");
  if (error) {
    console.error("[reports] templates:", error.message);
    return [];
  }
  return (data ?? []) as ReportTemplate[];
});

// النطاق الثابت للقالب، مُنظَّفاً — ويُفرض فوق مُرشِّحات الرابط
export function fixedFiltersOf(t: Pick<ReportTemplate, "definition"> | null): FixedFilters {
  return cleanFixedFilters(t?.definition.filters);
}

export function applyTemplateScope(p: ReportParams, t: Pick<ReportTemplate, "definition"> | null): ReportParams {
  return withFixedFilters(p, fixedFiltersOf(t));
}

export async function getReportTemplate(codeOrId: string): Promise<ReportTemplate | null> {
  const all = await getReportTemplates();
  return all.find((t) => t.code === codeOrId || t.id === codeOrId) ?? null;
}

// الأسماء للأبعاد — كلٌّ بنطاق قارئه (team_members للموظفين: المشرف فريقه)
export const getDimLabels = cache(async (): Promise<DimLabels> => {
  const supabase = await createClient();
  const [emp, proj, src, camp, stg, lr] = await Promise.all([
    supabase.from("team_members").select("id, full_name"),
    supabase.from("projects").select("id, name"),
    supabase.from("crm_sources").select("id, name"),
    supabase.from("crm_campaigns").select("id, name"),
    supabase.from("crm_stages").select("id, name"),
    supabase.from("crm_lost_reasons").select("id, name"),
  ]);
  const map = (rows: { id: string; name?: string; full_name?: string }[] | null) =>
    new Map((rows ?? []).map((r) => [r.id, (r.full_name ?? r.name ?? "") as string]));
  const employees = map(emp.data);
  return {
    employee: employees,
    owner: employees,
    team: map(proj.data),
    project: map(proj.data),
    source: map(src.data),
    campaign: map(camp.data),
    stage: map(stg.data),
    stage_from: map(stg.data),
    lost_reason: map(lr.data),
  };
});

export const EVENT_TYPE_LABELS: Record<string, string> = {
  activity: "تواصل", lead_created: "ليد جديد", lead_returned: "ليد مُعاد", qualified: "تأهيل",
  assignment: "إسناد", opportunity_created: "فرصة جديدة", stage_change: "تغيير مرحلة",
  reservation: "حجز", sale_completed: "بيع مكتمل", reservation_cancelled: "إلغاء حجز",
  task_completed: "مهمّة منجزة",
};

export const DIM_LABELS: Record<string, string> = {
  day: "اليوم", week: "الأسبوع", month: "الشهر", employee: "الموظف", owner: "المالك",
  team: "الفريق", project: "المشروع", source: "المصدر", campaign: "الحملة", stage: "المرحلة",
  stage_from: "من مرحلة", activity_type: "نوع التواصل", result: "النتيجة", direction: "الاتجاه",
  event_type: "نوع الحدث", lost_reason: "سبب الخسارة", temperature: "الحرارة",
  score_band: "شريحة الدرجة", payment_method: "طريقة الدفع", purpose: "غرض الشراء",
  area: "المنطقة", silence_bucket: "مدة الصمت",
};

export const SILENCE_ORDER = ["0–3", "4–7", "8–14", "15–21", "22–30", "30+", "بلا تواصل"];

export function dimValueLabel(dim: string, value: string | null, labels: DimLabels): string {
  if (value === null || value === "∅") return "غير محدّد";
  if (dim === "event_type") return EVENT_TYPE_LABELS[value] ?? value;
  const m = labels[dim];
  if (m) return m.get(value) ?? "خارج النطاق";
  return value;
}

// ===== المحرّك =====

export type QueryArgs = {
  metrics: string[];
  groupBy?: string[];
  range: DateRange;
  filters: Record<string, unknown>;
  basis: string;
  state: "snapshot" | "current";
  snapshotDate?: string | null;
};

export async function reportQuery(a: QueryArgs): Promise<{ rows: EngineRow[]; error?: string }> {
  if (!a.metrics.length) return { rows: [] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_report_query", {
    p_metrics: a.metrics,
    p_group_by: a.groupBy ?? [],
    p_from: a.range.from,
    p_to: a.range.to,
    p_filters: a.filters,
    p_basis: a.basis,
    p_state: a.state,
    p_snapshot_date: a.snapshotDate ?? null,
    p_run_id: null,
    p_limit: 5000,
  });
  if (error) {
    console.error("[reports] crm_report_query:", error.message);
    return { rows: [], error: error.message };
  }
  return {
    rows: ((data ?? []) as { dims: Record<string, string | null>; metrics: Record<string, number | null> }[])
      .map((r) => ({ dims: r.dims ?? {}, metrics: r.metrics ?? {} })),
  };
}

export type DrillRow = Record<string, unknown>;

export async function getReportDrilldown(a: {
  metric: string; range: DateRange; filters: Record<string, unknown>; dims: Record<string, string | null>;
  basis: string; state: "snapshot" | "current"; limit: number; offset: number;
}): Promise<{ total: number; rows: DrillRow[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_report_drill", {
    p_metric: a.metric,
    p_from: a.range.from,
    p_to: a.range.to,
    p_filters: a.filters,
    p_dims: a.dims,
    p_basis: a.basis,
    p_state: a.state,
    p_snapshot_date: null,
    p_limit: a.limit,
    p_offset: a.offset,
  });
  if (error) return { total: 0, rows: [], error: error.message };
  const rows = (data ?? []) as { total: number; row_data: DrillRow }[];
  return { total: Number(rows[0]?.total ?? 0), rows: rows.map((r) => r.row_data) };
}

// نهاية المدى اليوم أو بعده ← «الآن» من الجداول الحيّة؛ في الماضي ← لقطته
export function stateModeFor(range: DateRange, today: string): "snapshot" | "current" {
  return range.to >= today ? "current" : "snapshot";
}

// ===== توليد التقرير =====

const NO_ROWS: { rows: EngineRow[]; error?: string } = { rows: [] };

export async function generateReport(
  template: ReportTemplate, params: ReportParams, today: string, weekStartDow = 6
): Promise<GeneratedReport> {
  const t0 = Date.now();
  const [metricDefs, labels, lastSnapshot] = await Promise.all([getMetricDefs(), getDimLabels(), getLastSnapshotDate()]);
  const byCode = new Map(metricDefs.map((m) => [m.code, m]));
  const defsOf = (codes: string[] = []) => codes.map((c) => byCode.get(c)).filter((m): m is MetricDef => !!m);

  const filters = toEngineFilters(params);
  const cur = params.range;
  const prev = params.compareRange;
  const base = { filters, basis: params.basis };
  const stateNow = stateModeFor(cur, today);

  const sections = template.definition.sections ?? [];
  const results = await Promise.all(sections.map(async (s): Promise<SectionResult> => {
    const metrics = defsOf(s.metrics);
    const codes = metrics.map((m) => m.code);
    const hasState = metrics.some((m) => m.source === "state");

    switch (s.type) {
      case "kpis": {
        const [c, p] = await Promise.all([
          reportQuery({ ...base, metrics: codes, range: cur, state: stateNow }),
          prev ? reportQuery({ ...base, metrics: codes, range: prev, state: stateModeFor(prev, today) }) : Promise.resolve(NO_ROWS),
        ]);
        return {
          type: "kpis", def: s, metrics, current: c.rows[0] ?? { dims: {}, metrics: {} },
          previous: prev ? p.rows[0] ?? { dims: {}, metrics: {} } : undefined,
          stateAt: hasState ? (stateNow === "current" ? "الآن" : `لقطة ${cur.to}`) : "",
          error: c.error ?? p.error,
        };
      }
      case "trend": {
        const grain = (s.group_by?.[0] as "day" | "week" | "month") ?? autoGrain(cur);
        const g = grain === "day" ? autoGrain(cur) : grain;
        const r = await reportQuery({ ...base, metrics: codes, groupBy: [g], range: cur, state: "snapshot" });
        return { type: "trend", def: s, metrics, grain: g, rows: fillBuckets(r.rows, g, bucketKeys(cur, g, weekStartDow)), error: r.error };
      }
      case "table": {
        const dims = s.group_by ?? [];
        const [r, tot, ptot] = await Promise.all([
          reportQuery({ ...base, metrics: codes, groupBy: dims, range: cur, state: stateNow }),
          reportQuery({ ...base, metrics: codes, range: cur, state: stateNow }),
          prev ? reportQuery({ ...base, metrics: codes, range: prev, state: stateModeFor(prev, today) }) : Promise.resolve(NO_ROWS),
        ]);
        let rows = sortRows(r.rows, s.sort, metrics);
        if (dims.includes("day") || dims.includes("week") || dims.includes("month")) {
          const g = dims.find((d) => d === "day" || d === "week" || d === "month")!;
          if (dims.length === 1) rows = fillBuckets(r.rows, g, bucketKeys(cur, g as "day" | "week" | "month", weekStartDow));
        }
        return { type: "table", def: s, metrics, dims, rows, total: tot.rows[0], previousTotal: prev ? ptot.rows[0] : undefined, error: r.error ?? tot.error };
      }
      case "matrix": {
        const [rowDim, colDim] = s.group_by ?? ["employee", "day"];
        const metric = metrics[0];
        const state = hasState ? stateNow : "snapshot";
        const [cells, rowT, colT, grand] = await Promise.all([
          reportQuery({ ...base, metrics: codes, groupBy: [rowDim, colDim], range: cur, state }),
          reportQuery({ ...base, metrics: codes, groupBy: [rowDim], range: cur, state }),
          reportQuery({ ...base, metrics: codes, groupBy: [colDim], range: cur, state }),
          reportQuery({ ...base, metrics: codes, range: cur, state }),
        ]);
        const isTime = colDim === "day" || colDim === "week" || colDim === "month";
        const colKeys = isTime ? bucketKeys(cur, colDim as "day" | "week" | "month", weekStartDow)
          : colDim === "silence_bucket" ? SILENCE_ORDER : undefined;
        return {
          type: "matrix", def: s, metric, rowDim, colDim,
          matrix: buildMatrix(cells.rows, rowDim, colDim, metric, { colKeys, rowTotals: rowT.rows, colTotals: colT.rows, grand: grand.rows[0] }),
          error: cells.error,
        };
      }
      case "funnel": {
        const [c, p] = await Promise.all([
          reportQuery({ ...base, metrics: codes, range: cur, state: stateNow }),
          prev ? reportQuery({ ...base, metrics: codes, range: prev, state: stateModeFor(prev, today) }) : Promise.resolve(NO_ROWS),
        ]);
        const stepsOf = (row?: EngineRow) => funnelSteps(metrics.map((m) => ({ code: m.code, value: valueOf(row, m) })));
        return { type: "funnel", def: s, metrics, steps: stepsOf(c.rows[0]), previous: prev ? stepsOf(p.rows[0]) : null, error: c.error };
      }
      case "movement": {
        // الافتتاح: لقطة اليوم السابق لبداية المدى. الإقفال: لقطة نهايته أو الآن.
        const openingDate = addDaysIso(cur.from, -1);
        const [open, close, ev] = await Promise.all([
          reportQuery({ ...base, metrics: ["OPEN_OPPORTUNITIES", "PIPELINE_VALUE"], range: { from: openingDate, to: openingDate }, state: "snapshot", snapshotDate: openingDate }),
          reportQuery({ ...base, metrics: ["OPEN_OPPORTUNITIES", "PIPELINE_VALUE"], range: cur, state: stateNow }),
          reportQuery({ ...base, metrics: ["NEW_OPPORTUNITIES", "STAGE_PROGRESSIONS", "STAGE_REGRESSIONS", "REACTIVATED", "WON_DEALS", "LOST_DEALS"], range: cur, state: "snapshot" }),
        ]);
        const e = ev.rows[0]?.metrics ?? {};
        const n = (k: string) => Number(e[k] ?? 0);
        const o = open.rows[0];
        const c = close.rows[0];
        return {
          type: "movement", def: s, openingDate,
          closingAt: stateNow === "current" ? "الآن" : cur.to,
          movement: pipelineMovement({
            opening: o ? { count: Number(o.metrics.OPEN_OPPORTUNITIES ?? 0), value: Number(o.metrics.PIPELINE_VALUE ?? 0) } : null,
            closing: c ? { count: Number(c.metrics.OPEN_OPPORTUNITIES ?? 0), value: Number(c.metrics.PIPELINE_VALUE ?? 0) } : null,
            events: {
              newOpps: n("NEW_OPPORTUNITIES"), progressions: n("STAGE_PROGRESSIONS"), regressions: n("STAGE_REGRESSIONS"),
              reopened: n("REACTIVATED"), won: n("WON_DEALS"), lost: n("LOST_DEALS"),
            },
          }),
          error: open.error ?? close.error ?? ev.error,
        };
      }
      case "campaign_costs": {
        const rows = await getCampaignPerformance({ from: cur.from, to: cur.to });
        return { type: "campaign_costs", def: s, rows };
      }
      case "insights":
        return { type: "insights", def: s, insights: [] };
    }
  }));

  // الملاحظات بعد الأقسام: تبنى على ما حُسب + استعلامات صغيرة خاصّة بها
  const insightIdx = results.findIndex((r) => r.type === "insights");
  if (insightIdx >= 0) {
    results[insightIdx] = {
      type: "insights", def: results[insightIdx].def,
      insights: await buildInsights({ params, filters, byCode, labels, today, weekStartDow }),
    };
  }

  const rows = results.reduce((n, r) => n + ("rows" in r && Array.isArray(r.rows) ? r.rows.length : 0), 0);
  const errors = results.map((r) => r.error).filter((e): e is string => !!e);
  return {
    template, params, sections: results, metricDefs, labels, lastSnapshot,
    generatedAt: new Date().toISOString(), durationMs: Date.now() - t0, rows, errors,
  };
}

function addDaysIso(d: string, n: number): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

// ===== الملاحظات الوقائعية (§63 · §64) =====
async function buildInsights(ctx: {
  params: ReportParams; filters: Record<string, unknown>; byCode: Map<string, MetricDef>;
  labels: DimLabels; today: string; weekStartDow: number;
}): Promise<Insight[]> {
  const { params, filters, byCode, labels, today } = ctx;
  const out: Insight[] = [];
  const cur = params.range;
  const trendRange = { from: addDaysIso(cur.to, -13), to: cur.to };
  const base = { filters, basis: params.basis };

  const [trend, byProject, byEmployee, kpisCur, kpisPrev, bySourceCur, bySourcePrev] = await Promise.all([
    reportQuery({ ...base, metrics: ["TOTAL_ACTIVITIES", "NEW_LEADS"], groupBy: ["day"], range: trendRange, state: "snapshot" }),
    reportQuery({ ...base, metrics: ["NEW_LEADS"], groupBy: ["project"], range: cur, state: "snapshot" }),
    reportQuery({ ...base, metrics: ["TOTAL_ACTIVITIES", "OPEN_LEADS"], groupBy: ["employee"], range: cur, state: stateModeFor(cur, today) }),
    reportQuery({ ...base, metrics: ["NEW_LEADS", "CONVERSION_RATE", "NEGLECTED", "TOTAL_ACTIVITIES"], range: cur, state: stateModeFor(cur, today) }),
    params.compareRange
      ? reportQuery({ ...base, metrics: ["NEW_LEADS", "CONVERSION_RATE", "TOTAL_ACTIVITIES"], range: params.compareRange, state: "snapshot" })
      : Promise.resolve(NO_ROWS),
    reportQuery({ ...base, metrics: ["NEW_LEADS", "QUALIFIED_LEADS"], groupBy: ["source"], range: cur, state: "snapshot" }),
    params.compareRange
      ? reportQuery({ ...base, metrics: ["NEW_LEADS", "QUALIFIED_LEADS"], groupBy: ["source"], range: params.compareRange, state: "snapshot" })
      : Promise.resolve(NO_ROWS),
  ]);

  // ١) النشاط: آخر يوم مقابل متوسط الأيام السابقة، والأيام الشاذّة
  const acts = byCode.get("TOTAL_ACTIVITIES");
  if (acts) {
    const filled = fillBuckets(trend.rows, "day", bucketKeys(trendRange, "day"));
    out.push(...insightsFromTrend(filled.map((r) => ({ key: r.dims.day ?? "", value: valueOf(r, acts) ?? 0 })), "التواصل"));
  }

  // ٢) مقارنة بالفترة السابقة
  const k = kpisCur.rows[0];
  const p = kpisPrev.rows[0];
  if (k && p) {
    for (const code of ["TOTAL_ACTIVITIES", "NEW_LEADS", "CONVERSION_RATE"]) {
      const m = byCode.get(code);
      if (!m) continue;
      const i = changeInsight(m.name_ar, compareValues(valueOf(k, m), valueOf(p, m), m.good_direction), m.unit);
      if (i) out.push(i);
    }
  }

  // ٣) الصمت
  const neg = k ? Number(k.metrics.NEGLECTED ?? 0) : 0;
  if (neg > 0) {
    out.push({ kind: "risk", text: `${neg} فرصة مفتوحة بلا تواصل أطول من مهلة الإهمال — تفصيلها في «المتابعة والصمت».` });
  }

  // ٤) تركّز الليدات في مشروع
  const leadsTotal = k ? Number(k.metrics.NEW_LEADS ?? 0) : 0;
  const c = concentrationInsight(
    byProject.rows.filter((r) => r.dims.project).map((r) => ({
      name: dimValueLabel("project", r.dims.project, labels), value: Number(r.metrics.NEW_LEADS ?? 0),
    })),
    leadsTotal, "الليدات الجديدة", "المشروع"
  );
  if (c) out.push(c);

  // ٥) موظفون بليدات مفتوحة ولا تواصل مسجَّل في المدة — عدد لا أسماء
  const idle = byEmployee.rows.filter((r) => r.dims.employee && Number(r.metrics.OPEN_LEADS ?? 0) > 0 && Number(r.metrics.TOTAL_ACTIVITIES ?? 0) === 0);
  if (idle.length > 0) {
    out.push({ kind: "info", text: `${idle.length} من أصحاب الليدات المفتوحة لم يُسجَّل لهم تواصل في المدة (قد يكونون في إجازة أو يعملون خارج النظام).` });
  }

  // ٦) جودة المصدر: نسبة التأهيل تهبط ١٥ نقطة أو أكثر
  const prevBySource = new Map(bySourcePrev.rows.map((r) => [r.dims.source ?? "∅", r]));
  for (const r of bySourceCur.rows) {
    const leads = Number(r.metrics.NEW_LEADS ?? 0);
    const pr = prevBySource.get(r.dims.source ?? "∅");
    const pl = Number(pr?.metrics.NEW_LEADS ?? 0);
    if (leads < 10 || pl < 10) continue;
    const q1 = (Number(r.metrics.QUALIFIED_LEADS ?? 0) / leads) * 100;
    const q0 = (Number(pr?.metrics.QUALIFIED_LEADS ?? 0) / pl) * 100;
    if (q0 - q1 >= 15) {
      out.push({ kind: "drop", text: `المصدر «${dimValueLabel("source", r.dims.source, labels)}»: نسبة التأهيل ${Math.round(q1)}٪ مقابل ${Math.round(q0)}٪ في الفترة السابقة.` });
    }
  }

  if (out.length === 0) out.push({ kind: "info", text: "لا تغيّر لافت في المدة مقارنةً بما قبلها." });
  return out;
}

// ===== اللقطات =====

export type SnapshotStatus = {
  enabled: boolean;
  schedule: { hour: number; minute: number; timezone: string; max_retries: number; retry_minutes: number; retention_days: number };
  target_date: string;
  target_done: boolean;
  next_run_at: string;
  last_success: { run_id: string; snapshot_date: string; finished_at: string; status: string; duration_ms: number; rows: number; warning_count: number } | null;
  last_failure: { run_id: string; snapshot_date: string; started_at: string; stage: string; message: string; recovered: boolean } | null;
  fact_sync: { errors: number; out_of_sync: number } | null;
  coverage: { first_date: string | null; last_date: string | null; days: number };
};

export const getSnapshotStatus = cache(async (): Promise<SnapshotStatus | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_snapshot_status");
  if (error) {
    console.error("[reports] crm_snapshot_status:", error.message);
    return null;
  }
  return data as SnapshotStatus;
});

export const getLastSnapshotDate = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("crm_snapshot_runs").select("snapshot_date")
    .eq("is_current", true).order("snapshot_date", { ascending: false }).limit(1);
  return (data?.[0]?.snapshot_date as string | undefined) ?? null;
});

export type SnapshotRun = {
  id: string; snapshot_date: string; as_of: string; timezone: string; trigger_kind: string; method: string;
  status: string; requested_by_name: string | null; reason: string | null; attempt: number;
  started_at: string; finished_at: string | null; duration_ms: number | null; records_processed: number | null;
  records_created: number | null; warning_count: number; error_stage: string | null; is_current: boolean;
  supersedes: string | null; superseded_by: string | null;
};

export async function getSnapshotRuns(limit = 60): Promise<SnapshotRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("crm_snapshot_runs")
    .select("id, snapshot_date, as_of, timezone, trigger_kind, method, status, requested_by_name, reason, attempt, started_at, finished_at, duration_ms, records_processed, records_created, warning_count, error_stage, is_current, supersedes, superseded_by")
    .order("started_at", { ascending: false }).limit(limit);
  if (error) console.error("[reports] runs:", error.message);
  return (data ?? []) as SnapshotRun[];
}

export async function getSnapshotRunDetail(id: string): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_snapshot_run_detail", { p_run: id });
  if (error) return null;
  return data as Record<string, unknown>;
}

export type Correction = {
  metric: string; name_ar: string | null; original: number | null; corrected: number | null; diff: number | null;
  original_run: string; corrected_run: string; corrected_by: string | null; reason: string | null; corrected_at: string;
};

export async function getSnapshotCorrections(date: string): Promise<Correction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_snapshot_corrections", { p_date: date });
  if (error) return [];
  return (data ?? []) as Correction[];
}

export async function getFactReconcile() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_fact_reconcile_checked");
  if (error) return null;
  return (data ?? []) as { source: string; source_rows: number; fact_rows: number; missing: number; orphaned: number }[];
}

// ===== سجلّ التشغيل والجدولة =====

export type ReportRun = {
  id: string; template_id: string | null; template_code: string | null; report_name: string; template_version: number | null;
  requested_by: string | null; requested_by_name: string | null; recipients: string[]; schedule_id: string | null;
  trigger_kind: string; format: string; status: string; params: Record<string, unknown>;
  date_from: string | null; date_to: string | null; rows_returned: number | null; duration_ms: number | null;
  error: string | null; snapshot_date: string | null; data_version: string; started_at: string; finished_at: string | null;
};

export async function getReportRuns(limit = 100): Promise<ReportRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("crm_report_runs").select("*").order("started_at", { ascending: false }).limit(limit);
  if (error) console.error("[reports] report runs:", error.message);
  return (data ?? []) as ReportRun[];
}

export async function getReportRun(id: string): Promise<ReportRun | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("crm_report_runs").select("*").eq("id", id).maybeSingle();
  return (data as ReportRun | null) ?? null;
}

export async function logReportRun(r: {
  templateId: string | null; name: string; trigger: "manual" | "export"; format: "view" | "xlsx" | "csv" | "pdf";
  params: Record<string, unknown>; range: DateRange; rows: number; durationMs: number; errors: string[];
}): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_log_report_run", {
    p_template_id: r.templateId, p_report_name: r.name, p_trigger: r.trigger, p_format: r.format,
    p_params: r.params, p_from: r.range.from, p_to: r.range.to, p_rows: r.rows, p_duration_ms: r.durationMs,
    p_status: r.errors.length ? "failed" : "completed", p_error: r.errors.join(" | ") || null,
  });
  if (error) {
    console.error("[reports] log run:", error.message);
    return null;
  }
  return data as string;
}

export type ReportSchedule = {
  id: string; template_id: string; name: string; frequency: "daily" | "weekly" | "monthly"; run_time: string;
  timezone: string; weekday: number | null; month_day: number | null; range_preset: string; compare: string;
  filters: Record<string, unknown>; recipients: string[]; format: string; is_active: boolean;
  next_run_at: string | null; last_run_at: string | null; last_status: string | null; last_error: string | null;
  created_by: string | null;
};

export async function getSchedules(): Promise<ReportSchedule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("crm_report_schedules").select("*").order("created_at", { ascending: false });
  if (error) console.error("[reports] schedules:", error.message);
  return (data ?? []) as ReportSchedule[];
}

// ===== أسماء الخدمة كما في الطلب (§57) — كلها قالبٌ على نفس المحرّك =====
async function byCode(code: string, params: ReportParams, today: string) {
  const t = await getReportTemplate(code);
  return t ? generateReport(t, params, today) : null;
}
export const getDailyActivityReport = (p: ReportParams, today: string) => byCode("daily_crm_activity", p, today);
export const getSalesPerformanceReport = (p: ReportParams, today: string) => byCode("daily_sales_performance", p, today);
export const getProjectReport = (p: ReportParams, today: string) => byCode("project_performance", p, today);
export const getEmployeeReport = (p: ReportParams, today: string) => byCode("salesperson_productivity", p, today);
export const getPipelineReport = (p: ReportParams, today: string) => byCode("pipeline_snapshot", p, today);
export const getSourceReport = (p: ReportParams, today: string) => byCode("marketing_source", p, today);
export const getFollowupReport = (p: ReportParams, today: string) => byCode("followup_report", p, today);
export const getComparison = compareValues;

// ===== سياق الصفحة: الدور، واليوم ببغداد، وأول الأسبوع من الإعدادات =====
export const REPORT_ROLES = ["admin", "followup_manager", "supervisor", "employee", "marketing", "viewer", "accountant"];
export const MANAGE_ROLES = ["admin", "followup_manager"];
export const BUILDER_ROLES = ["admin", "followup_manager", "supervisor"];

export const getWeekStartDow = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { data } = await supabase.from("crm_settings").select("value").eq("key", "week_start_dow").maybeSingle();
  const n = Number(data?.value);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 6;
});

// وصف المُرشِّحات الفعّالة بالأسماء — لرأس التقرير والتصدير
export function filterSummary(p: ReportParams, labels: DimLabels): string {
  const parts: string[] = [];
  for (const [k, vals] of Object.entries(p.filters) as [FilterKey, string[]][]) {
    if (!vals?.length) continue;
    const names = vals.map((v) => (v === "__none__" ? "بلا" : dimValueLabel(k, v, labels)));
    parts.push(`${FILTER_LABELS[k]}: ${names.join("، ")}`);
  }
  if (p.scoreMin !== null || p.scoreMax !== null) parts.push(`الدرجة: ${p.scoreMin ?? 0}–${p.scoreMax ?? 100}`);
  return parts.length ? parts.join(" · ") : "بلا — كل ما في نطاقك";
}
