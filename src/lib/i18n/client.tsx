"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, Locale, dirOf } from "./config";
import ar, { type Dictionary } from "./dictionaries/ar";
import { tValue } from "./values";

// ============================================================
// اللغة في مكوّنات العميل.
//
// مكوّن العميل لا يقرأ الكوكي على الخادم، فالتخطيط (مكوّن خادم) يقرأ
// اللغة مرة واحدة ويمرّرها هنا عبر Context. هكذا لا يوجد أي وميض:
// أول رسم على الخادم يخرج باللغة الصحيحة.
// ============================================================

type I18nValue = {
  locale: Locale;
  t: Dictionary;
  dir: "rtl" | "ltr";
  /** ترجمة قيمة مخزّنة في القاعدة (مرحلة، حالة، أولوية…) */
  v: (value: string | null | undefined) => string;
};

const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  t: ar,
  dir: dirOf(DEFAULT_LOCALE),
  v: (value) => value ?? "",
});

export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: React.ReactNode;
}) {
  return (
    <I18nContext.Provider
      value={{
        locale,
        t: dictionary,
        dir: dirOf(locale),
        v: (value) => tValue(value, locale),
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
