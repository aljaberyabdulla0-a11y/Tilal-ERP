import { cache } from "react";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, Locale, isLocale } from "./config";
import ar, { type Dictionary } from "./dictionaries/ar";
import en from "./dictionaries/en";

// ============================================================
// اللغة على الخادم — لمكوّنات الخادم (أغلب صفحات النظام).
//
// ملفوفة بـ cache() مثل بقية دوال الخادم المشتركة: التخطيط والصفحة
// وشريط التبويبات كلها تسأل عن اللغة في نفس الطلب، فتُقرأ مرة واحدة.
// ============================================================

const DICTIONARIES: Record<Locale, Dictionary> = { ar, en };

export const getLocale = cache((): Locale => {
  const value = cookies().get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
});

// القاموس الجاهز: `const t = getT(); t.nav.dashboard`
export const getT = cache((): Dictionary => DICTIONARIES[getLocale()]);

// للحالات التي تحتاج الاثنين معاً
export const getI18n = cache((): { locale: Locale; t: Dictionary } => {
  const locale = getLocale();
  return { locale, t: DICTIONARIES[locale] };
});

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
