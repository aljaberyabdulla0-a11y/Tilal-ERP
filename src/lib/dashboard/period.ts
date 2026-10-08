import {
  type DateRange,
  type RangePreset,
  type ResolvedRange,
  autoGrain,
  comparisonRange,
  isIsoDate,
  resolveRange,
} from "@/lib/report-dates";

// ============================================================
// مُرشِّحات اللوحة — الفترة والمشروع والفريق والمصدر، والرابط هو الحالة.
//
//   ?range=last_month                      اختصار (يبقى «الشهر الماضي» إذا شورك غداً)
//   ?from=2026-09-01&to=2026-09-15         مدى مخصّص
//   &project=<uuid>&team=<uuid>&source=<uuid>&grain=week
//
// ⚠️ لا تعريف تاريخ هنا: الحساب كلّه من report-dates — نفس محرّك
//    تقارير الـCRM (مرآة crm_resolve_range في القاعدة). فـ«هذا الشهر»
//    في اللوحة هو «هذا الشهر» في التقرير الذي تفتحه بطاقته، وفترة
//    المقارنة هي نفسها.
//
// «الفريق» في هذا النظام هو فريق المشروع (employees.project_id، sql/037)،
// ومفاتيح project/team/source هي مفاتيح crm_rq_where في القاعدة حرفياً.
// ============================================================

export const DASH_PRESETS = [
  "today", "this_week", "this_month", "last_month", "this_quarter", "this_year",
] as const satisfies readonly RangePreset[];

export type DashPreset = (typeof DASH_PRESETS)[number] | "custom";
export type Grain = "day" | "week" | "month";

export type DashFilters = {
  preset: DashPreset;
  range: ResolvedRange;
  previous: DateRange | null;
  project: string | null;
  team: string | null;
  source: string | null;
  grain: Grain;
  today: string;
  /** بداية الأسبوع من إعداد week_start_dow — كي تطابق دلاء «أسبوعي» دلاءَ المحرّك */
  weekStartDow: number;
};

export type RawParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAINS = new Set<Grain>(["day", "week", "month"]);

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function uuidOrNull(v: string | string[] | undefined): string | null {
  const s = one(v);
  return s && UUID.test(s) ? s : null;
}

export function parseDashFilters(
  sp: RawParams,
  opts: { today: string; weekStartDow?: number; defaultPreset?: DashPreset }
): DashFilters {
  const from = one(sp.from);
  const to = one(sp.to);
  const rangeParam = one(sp.range);

  let preset: DashPreset;
  if (isIsoDate(from) || isIsoDate(to)) preset = "custom";
  else if (rangeParam && (DASH_PRESETS as readonly string[]).includes(rangeParam)) preset = rangeParam as DashPreset;
  else preset = opts.defaultPreset ?? "this_month";

  const range = resolveRange(preset, {
    today: opts.today,
    weekStartDow: opts.weekStartDow,
    from,
    to: to ?? (isIsoDate(from) ? from : undefined),
  });

  const g = one(sp.grain) as Grain | undefined;
  return {
    preset,
    range,
    previous: comparisonRange(range, "previous_period", preset),
    project: uuidOrNull(sp.project),
    team: uuidOrNull(sp.team),
    source: uuidOrNull(sp.source),
    grain: g && GRAINS.has(g) ? g : autoGrain(range),
    today: opts.today,
    weekStartDow: opts.weekStartDow ?? 6,
  };
}

// ما يُرسَل إلى crm_report_query بمعامل p_filters
export function engineFilters(f: Pick<DashFilters, "project" | "team" | "source">): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (f.project) out.project = [f.project];
  if (f.team) out.team = [f.team];
  if (f.source) out.source = [f.source];
  return out;
}

// الرابط من المُرشِّحات — بلا الافتراضي كي يبقى قصيراً
export function dashQuery(
  f: Pick<DashFilters, "preset" | "range" | "project" | "team" | "source">,
  extra: Record<string, string | null | undefined> = {},
  defaultPreset: DashPreset = "this_month"
): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.preset === "custom") {
    q.from = f.range.from;
    q.to = f.range.to;
  } else if (f.preset !== defaultPreset) {
    q.range = f.preset;
  }
  if (f.project) q.project = f.project;
  if (f.team) q.team = f.team;
  if (f.source) q.source = f.source;
  for (const [k, v] of Object.entries(extra)) if (v) q[k] = v;
  return q;
}

export function toSearch(q: Record<string, string>): string {
  const s = new URLSearchParams(q).toString();
  return s ? `?${s}` : "";
}

// ===== روابط النزول (Drill-down) =====
//
// كل رقمٍ من المحرّك يفتح صفوفه في شاشة النزول: نفس شرط المقياس
// ونفس المدى ونفس المُرشِّحات — فما يُعدّ في البطاقة هو ما يُسرَد.

export function drillHref(metric: string, f: Pick<DashFilters, "range" | "project" | "team" | "source" | "today">): string {
  const q: Record<string, string> = { metric, from: f.range.from, to: f.range.to };
  if (f.project) q.project = f.project;
  if (f.team) q.team = f.team;
  if (f.source) q.source = f.source;
  if (f.range.to >= f.today) q.state = "current";
  return `/dashboard/crm/reports/drill${toSearch(q)}`;
}

export function reportHref(template: string, f: Pick<DashFilters, "range" | "project" | "team" | "source">): string {
  const q: Record<string, string> = { template, from: f.range.from, to: f.range.to };
  if (f.project) q.project = f.project;
  if (f.team) q.team = f.team;
  if (f.source) q.source = f.source;
  return `/dashboard/crm/reports/view${toSearch(q)}`;
}

export function rangeHref(path: string, f: Pick<DashFilters, "range">, extra: Record<string, string> = {}): string {
  return `${path}${toSearch({ from: f.range.from, to: f.range.to, ...extra })}`;
}

// يربط سلسلتين زمنيتين بالموضع: اليوم الثالث من هذه الفترة مقابل الثالث من السابقة
export function alignByIndex<T>(current: T[], previous: T[]): (T | null)[] {
  return current.map((_, i) => previous[i] ?? null);
}
