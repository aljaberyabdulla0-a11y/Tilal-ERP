import { baghdadDate } from "@/lib/time";

// ============================================================
// محرّك المدى الزمني للتقارير (§15 · §24 · §56).
//
// ===== لماذا ملفّ خالص =====
//
// كل ما هنا حساب تواريخ بلا قاعدة ولا خادم، فيُختبر كاملاً في
// vitest. والتاريخ نصّ «YYYY-MM-DD» بتوقيت بغداد في كل مكان — لا
// كائن Date يعبر الحدود، لأن Date يحمل منطقة الجهاز معه، وخادم
// Vercel في UTC: «اليوم» عنده ينتهي الساعة ٣ فجراً بتوقيت بغداد.
//
// ⚠️ مرآة لـ crm_resolve_range و crm_week_start في القاعدة (099/096):
//    التقرير المجدول يحسب مداه هناك، والشاشة تحسبه هنا. تعريفان
//    يفترقان = تقرير مجدول يختلف عن نفسه مفتوحاً. الاختبارات تحرس
//    التطابق على الحالات نفسها.
// ============================================================

export type RangePreset =
  | "today" | "yesterday" | "last_7" | "last_14" | "last_30"
  | "this_week" | "last_week" | "this_month" | "last_month"
  | "this_quarter" | "last_quarter" | "this_year" | "last_year"
  | "last_n" | "custom";

export type CompareMode = "none" | "previous_period" | "previous_year";

export type DateRange = { from: string; to: string };

export type ResolvedRange = DateRange & {
  preset: RangePreset;
  days: number;         // طول المدى بالأيام (شاملاً الطرفين)
  label: string;        // وصف عربي للعنوان
};

export const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "yesterday", label: "أمس" },
  { key: "last_7", label: "آخر ٧ أيام" },
  { key: "last_14", label: "آخر ١٤ يوماً" },
  { key: "last_30", label: "آخر ٣٠ يوماً" },
  { key: "this_week", label: "هذا الأسبوع" },
  { key: "last_week", label: "الأسبوع الماضي" },
  { key: "this_month", label: "هذا الشهر" },
  { key: "last_month", label: "الشهر الماضي" },
  { key: "this_quarter", label: "هذا الربع" },
  { key: "last_quarter", label: "الربع الماضي" },
  { key: "this_year", label: "هذه السنة" },
  { key: "last_year", label: "السنة الماضية" },
];

// ما يظهر أزراراً سريعة فوق التقرير (§61) — والباقي في القائمة
export const QUICK_PRESETS: RangePreset[] = [
  "today", "yesterday", "last_7", "last_30", "this_month", "last_month", "this_quarter",
];

export const COMPARE_LABELS: Record<CompareMode, string> = {
  none: "بلا مقارنة",
  previous_period: "بالفترة السابقة",
  previous_year: "بالسنة السابقة",
};

// السبت — أسبوع العمل العراقي. الإعداد week_start_dow في القاعدة يغيّره.
export const DEFAULT_WEEK_START = 6;

// ===== حساب التواريخ نصّاً =====
// منتصف النهار UTC: لا يعبر حدّ يوم مهما أضفنا أو طرحنا.

function toUtc(d: string): Date {
  return new Date(`${d}T12:00:00Z`);
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return fromUtc(toUtc(v)) === v;   // يرفض ٢٠٢٦-٠٢-٣٠
}

export function addDays(d: string, n: number): string {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fromUtc(x);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86400000);
}

export function dayOfWeek(d: string): number {
  return toUtc(d).getUTCDay();
}

export function weekStart(d: string, weekStartDow = DEFAULT_WEEK_START): string {
  return addDays(d, -((dayOfWeek(d) - weekStartDow + 7) % 7));
}

export function monthStart(d: string): string {
  return `${d.slice(0, 7)}-01`;
}

export function monthEnd(d: string): string {
  return addDays(addMonths(monthStart(d), 1), -1);
}

// إضافة أشهر مع قصّ اليوم إلى آخر الشهر (٣١ يناير + شهر = ٢٨/٢٩ فبراير)
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export function quarterStart(d: string): string {
  const [y, m] = d.split("-").map(Number);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qm).padStart(2, "0")}-01`;
}

export function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function baghdadToday(now: Date = new Date()): string {
  return baghdadDate(now);
}

// ===== الاختصار ← المدى =====
export function resolvePreset(
  preset: RangePreset,
  opts: { today: string; weekStartDow?: number; n?: number; from?: string; to?: string }
): DateRange {
  const t = opts.today;
  const ws = weekStart(t, opts.weekStartDow ?? DEFAULT_WEEK_START);
  switch (preset) {
    case "today":        return { from: t, to: t };
    case "yesterday":    return { from: addDays(t, -1), to: addDays(t, -1) };
    case "last_7":       return { from: addDays(t, -6), to: t };
    case "last_14":      return { from: addDays(t, -13), to: t };
    case "last_30":      return { from: addDays(t, -29), to: t };
    case "last_n": {
      const n = Math.min(Math.max(Math.round(opts.n ?? 7), 1), 1100);
      return { from: addDays(t, -(n - 1)), to: t };
    }
    case "this_week":    return { from: ws, to: t };
    case "last_week":    return { from: addDays(ws, -7), to: addDays(ws, -1) };
    case "this_month":   return { from: monthStart(t), to: t };
    case "last_month": {
      const s = addMonths(monthStart(t), -1);
      return { from: s, to: monthEnd(s) };
    }
    case "this_quarter": return { from: quarterStart(t), to: t };
    case "last_quarter": {
      const s = addMonths(quarterStart(t), -3);
      return { from: s, to: addDays(quarterStart(t), -1) };
    }
    case "this_year":    return { from: `${t.slice(0, 4)}-01-01`, to: t };
    case "last_year": {
      const y = Number(t.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case "custom": {
      const from = isIsoDate(opts.from) ? opts.from : t;
      const to = isIsoDate(opts.to) ? opts.to : t;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

export function presetLabel(preset: RangePreset, range: DateRange, n?: number): string {
  if (preset === "last_n") return `آخر ${n ?? daysBetween(range.from, range.to) + 1} يوماً`;
  if (preset === "custom") {
    return range.from === range.to ? `يوم ${range.from}` : `من ${range.from} إلى ${range.to}`;
  }
  return PRESETS.find((p) => p.key === preset)?.label ?? preset;
}

export function resolveRange(
  preset: RangePreset,
  opts: { today: string; weekStartDow?: number; n?: number; from?: string; to?: string }
): ResolvedRange {
  const r = resolvePreset(preset, opts);
  return { ...r, preset, days: daysBetween(r.from, r.to) + 1, label: presetLabel(preset, r, opts.n) };
}

// ============================================================
// فترة المقارنة (§23 · §24)
//
//   previous_period   الفترة المكافئة السابقة:
//       • أشهر كاملة (الشهر الماضي، ربع كامل) ← الأشهر الكاملة قبلها
//         (أغسطس مقابل يوليو، لا ٣١ يوماً قبل أغسطس)
//       • من أول الشهر/الربع/السنة حتى يومٍ فيه ← نفس الموضع في
//         الشهر/الربع/السنة السابقة (١–٢٧ سبتمبر ← ١–٢٧ أغسطس)
//       • غير ذلك ← نفس الطول ملاصقاً قبله
//         (١–١٥ سبتمبر ← ١٧–٣١ أغسطس — مثال §24 حرفياً)
//   previous_year     نفس التواريخ قبل سنة
// ============================================================
export function comparisonRange(range: DateRange, mode: CompareMode, preset?: RangePreset): DateRange | null {
  if (mode === "none") return null;
  const yearBack = { from: addMonths(range.from, -12), to: addMonths(range.to, -12) };
  if (mode === "previous_year") return yearBack;

  // الاختصار يعرف قصده: «هذه السنة» تُقارن بالسنة الماضية حتى نفس اليوم،
  // لا بربعٍ قبلها لأن اليوم في فبراير
  if (preset === "this_year" || preset === "last_year") return yearBack;
  if (preset === "this_quarter") return { from: addMonths(range.from, -3), to: addMonths(range.to, -3) };
  // «هذا الشهر» حتى اليوم ← نفس الموضع من الشهر السابق (قصداً لا تخميناً:
  // مدى مخصّص ١–١٥ سبتمبر يُقارن بالأيام الملاصقة ١٧–٣١ أغسطس — §24)
  if (preset === "this_month") {
    const prevFrom = addMonths(range.from, -1);
    const target = addMonths(range.to, -1);
    return { from: prevFrom, to: target <= monthEnd(prevFrom) ? target : monthEnd(prevFrom) };
  }

  const len = daysBetween(range.from, range.to) + 1;

  // أشهر تقويمية كاملة ← الأشهر الكاملة قبلها (أغسطس ← يوليو، لا ٣١ يوماً)
  if (range.from.endsWith("-01") && range.to === monthEnd(range.to)) {
    const months = monthsSpanned(range.from, range.to);
    const from = addMonths(range.from, -months);
    return { from, to: addDays(range.from, -1) };
  }

  return { from: addDays(range.from, -len), to: addDays(range.from, -1) };
}

function monthsSpanned(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

// التجزئة الزمنية المناسبة لطول المدى — لا ٣٦٥ عموداً في رسم
export function autoGrain(range: DateRange): "day" | "week" | "month" {
  const len = daysBetween(range.from, range.to) + 1;
  if (len <= 62) return "day";
  if (len <= 190) return "week";
  return "month";
}

// عرض تاريخ قصير للمحاور والجداول: «٢٠ سبت»
const SHORT = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { day: "numeric", month: "short", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function shortDate(d: string): string {
  return isIsoDate(d) ? SHORT.format(toUtc(d)) : d;
}

export function longDate(d: string): string {
  return isIsoDate(d) ? LONG.format(toUtc(d)) : d;
}

// مفتاح البُعد الزمني من المحرّك: يوم «YYYY-MM-DD»، أسبوع (بدايته)، شهر «YYYY-MM»
export function bucketLabel(grain: "day" | "week" | "month", key: string): string {
  if (grain === "month") {
    return new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(toUtc(`${key}-01`));
  }
  if (grain === "week") return `أسبوع ${shortDate(key)}`;
  return shortDate(key);
}

// كل مفاتيح الفترة — لملء الأيام الصامتة بأصفار (الجمعة بلا تواصل
// صفرٌ في الرسم، لا فجوة يُظنّ أنها خطأ)
export function bucketKeys(range: DateRange, grain: "day" | "week" | "month", weekStartDow = DEFAULT_WEEK_START): string[] {
  const days = enumerateDays(range.from, range.to);
  const keys = days.map((d) =>
    grain === "day" ? d : grain === "week" ? weekStart(d, weekStartDow) : d.slice(0, 7)
  );
  return Array.from(new Set(keys));
}
