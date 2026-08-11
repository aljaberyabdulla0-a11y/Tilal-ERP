// ============================================================
// إعدادات اللغة — نقطة الحقيقة الوحيدة لأي شيء يخصّ اللغتين.
// The single source of truth for anything language-related.
// ============================================================

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

// العربية هي الافتراضية — النظام عراقي وأغلب مستخدميه عرب
export const DEFAULT_LOCALE: Locale = "ar";

// اسم الكوكي الذي يحفظ اختيار المستخدم (سنة كاملة)
export const LOCALE_COOKIE = "locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function dirOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

// اسم كل لغة بلغتها هي — هكذا يعرفها المستخدم مهما كانت اللغة الحالية
export const LOCALE_NAMES: Record<Locale, string> = {
  ar: "العربية",
  en: "English",
};
