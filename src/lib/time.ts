// ============================================================
// كل أوقات النظام بتوقيت بغداد.
//
// ليش هذا الملف موجود: الطوابع الزمنية تُحفظ في القاعدة بتوقيت UTC،
// وصفحات الخادم تعمل على خوادم Vercel بتوقيت UTC أيضاً — فلو استخدمنا
// توقيت الجهاز (new Date().getHours()) لظهرت البصمة ناقصة ٣ ساعات،
// ولحُسب التأخير والغياب غلط. هنا نجبر كل شيء على «Asia/Baghdad»
// مهما كان توقيت الخادم أو جهاز المستخدم.
// ============================================================

export const BAGHDAD_TZ = "Asia/Baghdad";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BAGHDAD_TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export type BaghdadParts = {
  year: number;
  month: number;   // 1-12
  day: number;     // 1-31
  hour: number;    // 0-23
  minute: number;
  second: number;
};

// تفكيك لحظة معيّنة إلى مكوّناتها بتوقيت بغداد
export function baghdadParts(input: Date | string | number): BaghdadParts {
  const d = input instanceof Date ? input : new Date(input);
  const parts = partsFormatter.formatToParts(d);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // بعض المتصفحات ترجع "24" بدل "00" لمنتصف الليل
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

// تاريخ اليوم في بغداد بصيغة YYYY-MM-DD
export function baghdadDate(input: Date | string | number = new Date()): string {
  const p = baghdadParts(input);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// وقت اللحظة في بغداد بصيغة HH:MM (24 ساعة)
export function baghdadTime(input: Date | string | number): string {
  const p = baghdadParts(input);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

// عدد الدقائق من منتصف ليل بغداد
export function baghdadMinutesOfDay(input: Date | string | number): number {
  const p = baghdadParts(input);
  return p.hour * 60 + p.minute;
}

// الشهر الحالي في بغداد بصيغة YYYY-MM
export function baghdadMonth(input: Date | string | number = new Date()): string {
  const p = baghdadParts(input);
  return `${p.year}-${pad(p.month)}`;
}

// فرق توقيت بغداد عن UTC بالدقائق عند لحظة معيّنة (العراق +3 بلا توقيت صيفي،
// لكن نحسبه ديناميكياً حتى لو تغيّرت القاعدة مستقبلاً)
function offsetMinutes(at: Date): number {
  const p = baghdadParts(at);
  const asIfUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asIfUTC - at.getTime()) / 60000;
}

// "2026-08-05" + "09:15" (بتوقيت بغداد) → طابع زمني ISO صحيح
export function baghdadStamp(dateISO: string, timeHM: string): string | null {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = timeHM.split(":").map(Number);
  if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return null;

  // تخمين أولي بفرض +3 ثم تصحيحه بالفرق الفعلي عند تلك اللحظة
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm) - 3 * 60 * 60000);
  const exact = new Date(Date.UTC(y, m - 1, d, hh, mm) - offsetMinutes(guess) * 60000);
  return Number.isNaN(exact.getTime()) ? null : exact.toISOString();
}

// يوم الأسبوع في بغداد: 0=الأحد ... 6=السبت
export function baghdadWeekday(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  // منتصف النهار يتفادى أي التباس عند حدود اليوم
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

// تاريخ مقروء بالعربية بتوقيت بغداد
export function baghdadDateLabel(
  input: Date | string | number = new Date(),
  options: Intl.DateTimeFormatOptions = {}
): string {
  const d = input instanceof Date ? input : new Date(input);
  return d.toLocaleDateString("ar", { timeZone: BAGHDAD_TZ, ...options });
}
