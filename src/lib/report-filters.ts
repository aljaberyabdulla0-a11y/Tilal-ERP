import {
  type CompareMode,
  type RangePreset,
  type ResolvedRange,
  type DateRange,
  PRESETS,
  comparisonRange,
  isIsoDate,
  resolveRange,
} from "@/lib/report-dates";

// ============================================================
// مُرشِّحات محرّك التقارير (§17 · §18 · §19).
//
// ===== الرابط هو الحالة =====
//
// كما في المُرشِّحات الموحّدة (crm-filters.ts): ما يُختار يعيش في
// الرابط، فيُشارَك ويُحفَظ عرضاً (crm_saved_views كيان «reports»)
// ويُصدَّر كما هو. والاختيار المتعدّد قيمٌ مفصولة بفاصلة:
//
//     ?range=last_7&project=a,b&employee=c&activity_type=مكالمة,واتساب
//
// ويُقبل الشكل المكرّر (?project=a&project=b) الذي يرسله نموذج GET
// بخانات الاختيار — فيعمل الشريط بلا JavaScript.
//
// ⚠️ المفاتيح هنا هي مفاتيح crm_rq_where في القاعدة (097) حرفياً.
//    مفتاحٌ لا تعرفه القاعدة يُتجاهل هناك بصمت — فيُحرس هنا بقائمة
//    مغلقة، والاختبار يقارنها بمفاتيح الدالة.
// ============================================================

export const FILTER_KEYS = [
  "project", "employee", "team", "source", "campaign", "stage", "stage_type",
  "activity_type", "result", "direction", "event_type", "reservation_status",
  "temperature", "score_band", "payment_method", "purpose", "area",
  "lost_reason", "silence_bucket", "unit", "building", "floor",
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

export type DateBasis = "event" | "lead_created" | "opp_created";

export const BASIS_LABELS: Record<DateBasis, string> = {
  event: "حسب تاريخ الحدث",
  lead_created: "حسب تاريخ إنشاء الليد",
  opp_created: "حسب تاريخ إنشاء الفرصة",
};

export const FILTER_LABELS: Record<FilterKey, string> = {
  project: "المشروع",
  employee: "الموظف",
  team: "الفريق",
  source: "المصدر",
  campaign: "الحملة",
  stage: "المرحلة",
  stage_type: "حالة الفرصة",
  activity_type: "نوع التواصل",
  result: "النتيجة",
  direction: "الاتجاه",
  event_type: "نوع الحدث",
  reservation_status: "حالة الحجز",
  temperature: "الحرارة",
  score_band: "شريحة الدرجة",
  payment_method: "طريقة الدفع",
  purpose: "غرض الشراء",
  area: "المنطقة",
  lost_reason: "سبب الخسارة",
  silence_bucket: "مدة الصمت",
  unit: "الوحدة",
  building: "المبنى",
  floor: "الطابق",
};

// قيمة «بلا» — تُطابق __none__ في crm_rq_where (مثل: بلا مشروع)
export const NONE_VALUE = "__none__";

export type ReportParams = {
  preset: RangePreset;
  n: number | null;
  range: ResolvedRange;
  compare: CompareMode;
  compareRange: DateRange | null;
  basis: DateBasis;
  filters: Partial<Record<FilterKey, string[]>>;
  scoreMin: number | null;
  scoreMax: number | null;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

const PRESET_KEYS = new Set<string>([...PRESETS.map((p) => p.key), "last_n", "custom"]);
const COMPARE_KEYS = new Set<string>(["none", "previous_period", "previous_year"]);
const BASIS_KEYS = new Set<string>(["event", "lead_created", "opp_created"]);

// قيمة واحدة أو قائمة أو نصّ بفواصل ← قائمة نظيفة بلا تكرار
export function listParam(v: string | string[] | undefined): string[] {
  const raw = Array.isArray(v) ? v : v === undefined ? [] : [v];
  const out = raw
    .flatMap((x) => x.split(","))
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && x.length <= 200);
  return Array.from(new Set(out)).slice(0, 100);
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseReportParams(
  sp: RawSearchParams,
  opts: { today: string; weekStartDow?: number; defaults?: { preset?: RangePreset; compare?: CompareMode; basis?: DateBasis } }
): ReportParams {
  const from = one(sp.from);
  const to = one(sp.to);
  const daysRaw = Number(one(sp.days));

  // صراحةٌ تغلب: تاريخان ← مخصّص؛ عدد أيام ← آخر ن يوماً؛ وإلا الاختصار
  let preset: RangePreset;
  const rangeParam = one(sp.range);
  if (isIsoDate(from) || isIsoDate(to)) preset = "custom";
  else if (Number.isFinite(daysRaw) && daysRaw >= 1) preset = "last_n";
  else if (rangeParam && PRESET_KEYS.has(rangeParam) && rangeParam !== "custom" && rangeParam !== "last_n") preset = rangeParam as RangePreset;
  else preset = opts.defaults?.preset ?? "last_7";

  const n = preset === "last_n" ? Math.min(Math.round(daysRaw), 1100) : null;
  const range = resolveRange(preset, {
    today: opts.today,
    weekStartDow: opts.weekStartDow,
    n: n ?? undefined,
    from,
    to: to ?? (isIsoDate(from) ? from : undefined),
  });

  const compareRaw = one(sp.compare);
  const compare: CompareMode =
    compareRaw && COMPARE_KEYS.has(compareRaw) ? (compareRaw as CompareMode) : opts.defaults?.compare ?? "previous_period";

  const basisRaw = one(sp.basis);
  const basis: DateBasis = basisRaw && BASIS_KEYS.has(basisRaw) ? (basisRaw as DateBasis) : opts.defaults?.basis ?? "event";

  const filters: Partial<Record<FilterKey, string[]>> = {};
  for (const k of FILTER_KEYS) {
    // «owner» اسم الموظف في المُرشِّحات الموحّدة (crm-filters) — يُقبل هنا أيضاً
    const vals = listParam(k === "employee" ? ([] as string[]).concat(sp.employee ?? [], sp.owner ?? []) : sp[k]);
    if (vals.length) filters[k] = vals;
  }

  const sMin = Number(one(sp.score_min));
  const sMax = Number(one(sp.score_max));

  return {
    preset,
    n,
    range,
    compare,
    compareRange: comparisonRange(range, compare, preset),
    basis,
    filters,
    scoreMin: Number.isFinite(sMin) && one(sp.score_min) !== undefined && one(sp.score_min) !== "" ? sMin : null,
    scoreMax: Number.isFinite(sMax) && one(sp.score_max) !== undefined && one(sp.score_max) !== "" ? sMax : null,
  };
}

// ما يُرسَل إلى crm_report_query بمعامل p_filters
export function toEngineFilters(p: Pick<ReportParams, "filters" | "scoreMin" | "scoreMax">): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p.filters)) if (v && v.length) out[k] = v;
  if (p.scoreMin !== null) out.score_min = p.scoreMin;
  if (p.scoreMax !== null) out.score_max = p.scoreMax;
  return out;
}

// الرابط من المعاملات — بلا القيم الافتراضية كي يبقى قصيراً ويُحفظ نظيفاً
export function toQuery(
  p: ReportParams,
  defaults: { preset?: RangePreset; compare?: CompareMode; basis?: DateBasis } = {}
): Record<string, string> {
  const q: Record<string, string> = {};
  if (p.preset === "custom") {
    q.from = p.range.from;
    q.to = p.range.to;
  } else if (p.preset === "last_n" && p.n) {
    q.days = String(p.n);
  } else if (p.preset !== (defaults.preset ?? "last_7")) {
    q.range = p.preset;
  }
  if (p.compare !== (defaults.compare ?? "previous_period")) q.compare = p.compare;
  if (p.basis !== (defaults.basis ?? "event")) q.basis = p.basis;
  for (const k of FILTER_KEYS) {
    const v = p.filters[k];
    if (v && v.length) q[k] = v.join(",");
  }
  if (p.scoreMin !== null) q.score_min = String(p.scoreMin);
  if (p.scoreMax !== null) q.score_max = String(p.scoreMax);
  return q;
}

export function queryString(q: Record<string, string>): string {
  const s = new URLSearchParams(q).toString();
  return s ? `?${s}` : "";
}

export function activeFilterCount(p: Pick<ReportParams, "filters" | "scoreMin" | "scoreMax">): number {
  return Object.values(p.filters).filter((v) => v && v.length).length
    + (p.scoreMin !== null ? 1 : 0) + (p.scoreMax !== null ? 1 : 0);
}

// ============================================================
// النطاق الثابت للتقرير — «تقرير مشروع لامك» (منشئ التقارير).
//
// القالب يحمل definition.filters، ويُفرض فوق ما في الرابط في كل
// مكان يُولَّد فيه التقرير: الفتح، والنزول، والتصدير، والمجدول.
// الثابت **يغلب** — فرابطٌ قديم أو مُعدَّل يدوياً لا يُخرج تقرير
// «لامك» إلى مشروع آخر. والمفاتيح غير المعروفة تُهمَل كما في الرابط.
// ============================================================
export type FixedFilters = Partial<Record<FilterKey, string[]>>;

export function cleanFixedFilters(raw: unknown): FixedFilters {
  const out: FixedFilters = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of FILTER_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (Array.isArray(v)) {
      const vals = listParam(v.map(String));
      if (vals.length) out[k] = vals;
    }
  }
  return out;
}

export function withFixedFilters(p: ReportParams, fixed: FixedFilters): ReportParams {
  const keys = Object.keys(fixed) as FilterKey[];
  if (keys.length === 0) return p;
  return { ...p, filters: { ...p.filters, ...fixed } };
}
