import type { Locale } from "@/lib/i18n/config";
import { BAGHDAD_TZ, baghdadParts } from "@/lib/time";

// ============================================================
// تنسيق أرقام اللوحات وتواريخها — حسب اللغة، وبتوقيت بغداد دائماً.
//
// خالص بلا خادم ولا قاعدة: يُختبر في vitest ويستعمله مكوّن العميل.
//
// ⚠️ الأرقام لاتينية في اللغتين (‎1,250‎ لا ١٬٢٥٠): هكذا يكتبها النظام
//    كلّه (formatPrice) وهكذا تُنسخ إلى الإكسل، وأرقامٌ بنظامين في
//    شاشة واحدة تُربك قارئ المبالغ. الكلمات وحدها تتبع اللغة.
// ============================================================

const NUM_LOCALE: Record<Locale, string> = { ar: "ar-u-nu-latn", en: "en-US" };

export type Unit = "money" | "count" | "pct" | "days" | "ratio";

// ============================================================
// الاتجاه: في العربية يُعزَل الجزء الرقمي بمحارف العزل (LRI … PDI)
// فيبقى «‎-966,185‎» سالباً من يساره و«245.8 مليون د.ع» بترتيبه الصحيح
// داخل سطرٍ عربي — بلا dir="ltr" على العنصر (كان يقلب ترتيب الكلمات
// العربية بجانب الرقم فتُقرأ «د.ع مليون 245.8»).
// ============================================================
const LRI = "\u2066"; // LEFT-TO-RIGHT ISOLATE
const PDI = "\u2069"; // POP DIRECTIONAL ISOLATE
export function isolate(s: string, locale: Locale): string {
  return locale === "ar" ? `${LRI}${s}${PDI}` : s;
}

function rawNumber(n: number, locale: Locale, digits: number): string {
  return Number(n).toLocaleString(NUM_LOCALE[locale], { maximumFractionDigits: digits });
}

export function fmtNumber(n: number | null | undefined, locale: Locale, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return isolate(rawNumber(Number(n), locale, digits), locale);
}

// مبلغ مختصر: 245.8 مليون / 245.8M — والعملة من القاموس
export function fmtCompact(n: number | null | undefined, locale: Locale): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (Math.abs(v) < 10_000) return fmtNumber(v, locale);
  const parts = new Intl.NumberFormat(NUM_LOCALE[locale], {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: Math.abs(v) >= 1e9 ? 2 : 1,
  }).formatToParts(v);
  if (locale !== "ar") return parts.map((p) => p.value).join("");
  // العربية: الرقم معزولاً ثم كلمة الاختصار (ألف/مليون/مليار)
  const numeric = parts.filter((p) => p.type !== "compact" && p.type !== "literal").map((p) => p.value).join("");
  const word = parts.filter((p) => p.type === "compact").map((p) => p.value).join("");
  return word ? `${isolate(numeric, locale)} ${word}` : isolate(numeric, locale);
}

export function fmtMoney(
  n: number | null | undefined,
  locale: Locale,
  currency: string,
  opts: { compact?: boolean } = {}
): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const body = opts.compact === false ? fmtNumber(n, locale) : fmtCompact(n, locale);
  return locale === "ar" ? `${body} ${currency}` : `${currency} ${body}`;
}

export function fmtPct(n: number | null | undefined, locale: Locale, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return isolate(`${rawNumber(Number(n), locale, digits)}%`, locale);
}

export function fmtValue(
  n: number | null | undefined,
  unit: Unit,
  locale: Locale,
  words: { currency: string; days: string }
): string {
  switch (unit) {
    case "money": return fmtMoney(n, locale, words.currency);
    case "pct": return fmtPct(n, locale);
    case "ratio": return n === null || n === undefined ? "—" : isolate(`${rawNumber(Number(n), locale, 2)}×`, locale);
    case "days": return n === null || n === undefined ? "—" : `${fmtNumber(n, locale, 1)} ${words.days}`;
    default: return fmtNumber(n, locale);
  }
}

// ===== الوقت =====

export type DayPart = "morning" | "afternoon" | "evening";

// جزء اليوم بساعة بغداد — لا بساعة خادم Vercel (UTC): كانت اللوحة تقول
// «صباح الخير» حتى الثالثة عصراً بتوقيت بغداد.
export function dayPart(now: Date = new Date()): DayPart {
  const h = baghdadParts(now).hour;
  if (h >= 4 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  return "evening";
}

export function fmtLongDate(now: Date, locale: Locale): string {
  return now.toLocaleDateString(locale === "ar" ? "ar-u-nu-latn" : "en-GB", {
    timeZone: BAGHDAD_TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// تاريخ قصير لنصّ «YYYY-MM-DD» — منتصف النهار UTC لا يعبر حدّ يوم
export function fmtShortDate(iso: string, locale: Locale): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "ar" ? "ar-u-nu-latn" : "en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
}

// تسمية محور الزمن حسب الحبّة: يوم «12 أكت» / أسبوع «12 أكت» / شهر «أكت 26»
export function fmtBucket(key: string, grain: "day" | "week" | "month", locale: Locale): string {
  if (grain === "month") {
    const d = new Date(`${key.slice(0, 7)}-01T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return key;
    return d.toLocaleDateString(locale === "ar" ? "ar-u-nu-latn" : "en-GB", {
      timeZone: "UTC",
      month: "short",
      year: "2-digit",
    });
  }
  return fmtShortDate(key, locale);
}

// «قبل 12 دقيقة» — نسبةً إلى الآن، والأقدم من أسبوع تاريخاً صريحاً
export function fmtRelative(iso: string, locale: Locale, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffSec = Math.round((t - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en", { numeric: "auto" });
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(Math.round(diffSec / 86400), "day");
  return new Date(iso).toLocaleDateString(locale === "ar" ? "ar-u-nu-latn" : "en-GB", {
    timeZone: BAGHDAD_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// قالب بسيط: fill("{n} من {total}", { n: 3, total: 9 })
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
