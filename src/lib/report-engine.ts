// ============================================================
// منطق التقارير الخالص — ما بعد المحرّك (097).
//
// ⚠️ لا تعريف مقياسٍ هنا. الأرقام تأتي محسوبة من crm_report_query،
//    وما يُحسب هنا **عرضٌ** لها فقط: الفرق والنسبة بين فترتين، ملء
//    الأيام الصامتة بأصفار، قلب الصفوف إلى مصفوفة، تحويلات القمع
//    بين خطواته، وملاحظات وقائعية.
//
//    والقاعدة: لا جمع لمقياسٍ فريد. «عملاء فريدون» لموظفَين ليس
//    مجموعهما (العميل المشترك يُعدّ مرتين) — فالمجاميع تُطلب من
//    المحرّك بلا تجزئة، لا تُجمع هنا. الدالة `canSum` تحرس ذلك.
//
// بلا استيراد من الخادم: يُختبر في vitest، ويستعمله مكوّن العميل.
// ============================================================

export type MetricUnit = "count" | "money" | "pct" | "days";

export type MetricDef = {
  code: string;
  name_ar: string;
  name_en: string;
  category: string;
  source: "events" | "state";
  agg: string;
  numerator: string | null;
  denominator: string | null;
  unit: MetricUnit;
  good_direction: "up" | "down" | null;
  definition: string;
  formula: string;
  date_field: string;
  source_tables: string;
  notes: string | null;
  legacy_equivalent: string | null;
  owner: string;
  sort_order: number;
  updated_at: string;
};

export type EngineRow = {
  dims: Record<string, string | null>;
  metrics: Record<string, number | null>;
};

export type Delta = {
  current: number | null;
  previous: number | null;
  change: number | null;
  pct: number | null;
  // اتجاه الحكم: جيد/سيئ بحسب good_direction، أو محايد
  tone: "good" | "bad" | "neutral";
};

// ===== المقارنة (§23) =====
export function compareValues(current: number | null, previous: number | null, good: "up" | "down" | null): Delta {
  if (current === null || previous === null) {
    return { current, previous, change: null, pct: null, tone: "neutral" };
  }
  const change = round(current - previous, 2);
  // من صفر: لا نسبة (القسمة على صفر ليست «+∞٪» — هي «جديد»)
  const pct = previous === 0 ? null : round(((current - previous) / Math.abs(previous)) * 100, 1);
  let tone: Delta["tone"] = "neutral";
  if (change !== 0 && good) tone = (change > 0) === (good === "up") ? "good" : "bad";
  return { current, previous, change, pct, tone };
}

export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// القيمة الغائبة: العدّ والمجموع صفرٌ (لا حدث = صفر)، والمتوسط والنسبة
// «غير متاح» (لا متوسط لصفر صفقات — ٠ يكذب)
export function valueOf(row: EngineRow | undefined, m: MetricDef): number | null {
  const v = row?.metrics[m.code];
  if (v === undefined || v === null) {
    return m.agg === "ratio" || m.agg.startsWith("avg:") ? null : 0;
  }
  return Number(v);
}

// هل يجوز جمع المقياس عبر مجموعات؟ — لا للفريد والمتوسط والنسبة
export function canSum(m: Pick<MetricDef, "agg">): boolean {
  return m.agg === "count" || m.agg.startsWith("sum:");
}

// ===== مفتاح الصفّ =====
export function dimKey(dims: Record<string, string | null>, keys: string[]): string {
  return keys.map((k) => dims[k] ?? "∅").join("¦");
}

export function indexRows(rows: EngineRow[], keys: string[]): Map<string, EngineRow> {
  const m = new Map<string, EngineRow>();
  for (const r of rows) m.set(dimKey(r.dims, keys), r);
  return m;
}

// ===== الأيام الصامتة (§25) =====
// كل مفتاح في الفترة صفٌّ — يومٌ بلا حدث صفرٌ مرئيّ لا فجوة
export function fillBuckets(rows: EngineRow[], grainKey: string, bucketKeys: string[]): EngineRow[] {
  const idx = new Map(rows.map((r) => [r.dims[grainKey] ?? "", r]));
  return bucketKeys.map((k) => idx.get(k) ?? { dims: { [grainKey]: k }, metrics: {} });
}

// ===== الترتيب =====
export function sortRows(rows: EngineRow[], sort: string | undefined, metrics: MetricDef[]): EngineRow[] {
  if (!sort) return rows;
  const desc = sort.startsWith("-");
  const code = sort.replace(/^[-+]/, "");
  const m = metrics.find((x) => x.code === code);
  if (!m) return rows;
  return [...rows].sort((a, b) => {
    const va = valueOf(a, m) ?? -Infinity;
    const vb = valueOf(b, m) ?? -Infinity;
    return desc ? vb - va : va - vb;
  });
}

// ===== المصفوفة (§26) =====
export type Matrix = {
  rowKeys: string[];
  colKeys: string[];
  cells: Map<string, number | null>;          // `${row}¦${col}`
  rowTotals: Map<string, number | null>;
  colTotals: Map<string, number | null>;
  grand: number | null;
  max: number;
};

// المجاميع تأتي من المحرّك (استعلامات بلا بُعد) لا من جمع الخلايا —
// فتصحّ للفريد أيضاً. ويُمرَّر ترتيب الأعمدة (الأيام بترتيبها كاملة).
export function buildMatrix(
  cellsRows: EngineRow[], rowDim: string, colDim: string, metric: MetricDef,
  opts: { colKeys?: string[]; rowTotals?: EngineRow[]; colTotals?: EngineRow[]; grand?: EngineRow }
): Matrix {
  const cells = new Map<string, number | null>();
  const rowSet = new Set<string>();
  const colSet = new Set<string>(opts.colKeys ?? []);
  let max = 0;
  for (const r of cellsRows) {
    const rk = r.dims[rowDim] ?? "∅";
    const ck = r.dims[colDim] ?? "∅";
    const v = valueOf(r, metric);
    rowSet.add(rk);
    colSet.add(ck);
    cells.set(`${rk}¦${ck}`, v);
    if (v !== null && v > max) max = v;
  }
  const rowTotals = new Map<string, number | null>();
  for (const r of opts.rowTotals ?? []) rowTotals.set(r.dims[rowDim] ?? "∅", valueOf(r, metric));
  const colTotals = new Map<string, number | null>();
  for (const r of opts.colTotals ?? []) colTotals.set(r.dims[colDim] ?? "∅", valueOf(r, metric));

  const rowKeys = Array.from(rowSet).sort((a, b) => (rowTotals.get(b) ?? 0) - (rowTotals.get(a) ?? 0));
  const colKeys = opts.colKeys ? [...opts.colKeys, ...Array.from(colSet).filter((c) => !opts.colKeys!.includes(c))] : Array.from(colSet).sort();
  return {
    rowKeys, colKeys, cells, rowTotals, colTotals,
    grand: opts.grand ? valueOf(opts.grand, metric) : null,
    max,
  };
}

// ===== القمع (§28) =====
export type FunnelStep = {
  code: string;
  value: number;
  pctOfFirst: number | null;
  stepConversion: number | null;
  dropOff: number | null;
};

export function funnelSteps(values: { code: string; value: number | null }[]): FunnelStep[] {
  const first = values[0]?.value ?? 0;
  return values.map((s, i) => {
    const v = s.value ?? 0;
    const prev = i > 0 ? values[i - 1].value ?? 0 : null;
    return {
      code: s.code,
      value: v,
      pctOfFirst: first > 0 ? round((v / first) * 100, 1) : null,
      stepConversion: prev ? round((v / prev) * 100, 1) : null,
      dropOff: prev ? round(100 - (v / prev) * 100, 1) : null,
    };
  });
}

// ===== حركة الأنابيب (§30) =====
export type Movement = {
  openingCount: number | null;
  openingValue: number | null;
  newOpps: number;
  progressions: number;
  regressions: number;
  reopened: number;
  won: number;
  lost: number;
  closingCount: number | null;
  closingValue: number | null;
  netCount: number | null;
  netValue: number | null;
  // التوازن: الافتتاح + جديد + معاد فتحه − فوز − خسارة = الإقفال؟ الفرق
  // يكشف ما لا تفسّره الأحداث (حذف، دمج، فرصٌ بلا تاريخ) — يُعرض لا يُخفى
  unexplained: number | null;
};

export function pipelineMovement(input: {
  opening: { count: number | null; value: number | null } | null;
  closing: { count: number | null; value: number | null } | null;
  events: { newOpps: number; progressions: number; regressions: number; reopened: number; won: number; lost: number };
}): Movement {
  const oc = input.opening?.count ?? null;
  const cc = input.closing?.count ?? null;
  const ov = input.opening?.value ?? null;
  const cv = input.closing?.value ?? null;
  const e = input.events;
  return {
    openingCount: oc, openingValue: ov,
    newOpps: e.newOpps, progressions: e.progressions, regressions: e.regressions,
    reopened: e.reopened, won: e.won, lost: e.lost,
    closingCount: cc, closingValue: cv,
    netCount: oc !== null && cc !== null ? cc - oc : null,
    netValue: ov !== null && cv !== null ? round(cv - ov, 2) : null,
    unexplained: oc !== null && cc !== null ? cc - (oc + e.newOpps + e.reopened - e.won - e.lost) : null,
  };
}

// ===== الملاحظات (§63 · §64) =====
//
// وقائع لا أحكام: «انخفض التواصل ١٨٪ عن متوسط الأيام السبعة السابقة»
// لا «الفريق كسول». ولا اسم موظف في ملاحظة سلبية — الملاحظة تُشير
// إلى مكان النظر، والجدول تحتها يُظهر من.
export type Insight = { kind: "drop" | "spike" | "concentration" | "risk" | "change" | "info"; text: string };

export function insightsFromTrend(series: { key: string; value: number }[], label: string, minBase = 5): Insight[] {
  const out: Insight[] = [];
  if (series.length < 4) return out;
  const last = series[series.length - 1];
  const prior = series.slice(Math.max(0, series.length - 8), series.length - 1);
  const avg = prior.reduce((s, p) => s + p.value, 0) / prior.length;
  if (avg >= minBase) {
    const pct = round(((last.value - avg) / avg) * 100, 0);
    if (Math.abs(pct) >= 15) {
      out.push({
        kind: pct < 0 ? "drop" : "spike",
        text: `${label}: ${last.value} في آخر يوم — ${pct > 0 ? "أعلى" : "أقلّ"} بنسبة ${Math.abs(pct)}٪ من متوسط الأيام ${prior.length} السابقة (${round(avg, 1)}).`,
      });
    }
  }
  // أيام شاذّة: أبعد من انحرافين معياريين عن متوسط المدى
  const vals = series.map((s) => s.value);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  if (sd > 0 && mean >= minBase) {
    for (const s of series) {
      if (s.value > mean + 2 * sd) out.push({ kind: "spike", text: `${label}: ارتفاع غير معتاد يوم ${s.key} (${s.value} مقابل متوسط ${round(mean, 1)}).` });
      else if (s.value < mean - 2 * sd) out.push({ kind: "drop", text: `${label}: انخفاض غير معتاد يوم ${s.key} (${s.value} مقابل متوسط ${round(mean, 1)}).` });
    }
  }
  return out;
}

export function concentrationInsight(
  rows: { name: string; value: number }[], total: number, what: string, dimLabel: string, threshold = 40
): Insight | null {
  if (total < 10 || rows.length < 2) return null;
  const top = [...rows].sort((a, b) => b.value - a.value)[0];
  const share = round((top.value / total) * 100, 0);
  if (share < threshold) return null;
  return { kind: "concentration", text: `${dimLabel} «${top.name}» صنع ${share}٪ من ${what} (${top.value} من ${total}).` };
}

export function changeInsight(label: string, d: Delta, unit: MetricUnit, minBase = 5): Insight | null {
  if (d.current === null || d.previous === null) return null;
  if (unit === "pct") {
    if (d.change === null || Math.abs(d.change) < 5) return null;
    return { kind: "change", text: `${label}: ${d.current}٪ مقابل ${d.previous}٪ في الفترة السابقة (${d.change > 0 ? "+" : ""}${d.change} نقطة).` };
  }
  if (d.previous < minBase || d.pct === null || Math.abs(d.pct) < 20) return null;
  return {
    kind: d.pct < 0 ? "drop" : "spike",
    text: `${label}: ${fmtNum(d.current)} مقابل ${fmtNum(d.previous)} في الفترة السابقة (${d.pct > 0 ? "+" : ""}${d.pct}٪).`,
  };
}

// ===== التنسيق =====
export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function fmtMetric(n: number | null | undefined, unit: MetricUnit): string {
  if (n === null || n === undefined) return "—";
  switch (unit) {
    case "pct": return `${fmtNum(n, 1)}٪`;
    case "days": return `${fmtNum(n, 1)} يوم`;
    case "money": return fmtCompact(n);
    default: return fmtNum(n);
  }
}

export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${fmtNum(n / 1e9, 2)} مليار`;
  if (a >= 1e6) return `${fmtNum(n / 1e6, 2)} مليون`;
  if (a >= 1e4) return `${fmtNum(n / 1e3, 1)} ألف`;
  return fmtNum(n);
}

export function fmtDelta(d: Delta, unit: MetricUnit): string {
  if (d.change === null) return "";
  const sign = d.change > 0 ? "+" : d.change < 0 ? "−" : "±";
  const abs = Math.abs(d.change);
  const val = unit === "pct" ? `${fmtNum(abs, 1)} نقطة` : unit === "money" ? fmtCompact(abs) : fmtNum(abs, unit === "days" ? 1 : 0);
  const pct = unit === "pct" || d.pct === null ? (d.previous === 0 && d.change !== 0 ? " (جديد)" : "") : ` (${d.pct > 0 ? "+" : ""}${d.pct}٪)`;
  return `${sign}${val}${pct}`;
}
