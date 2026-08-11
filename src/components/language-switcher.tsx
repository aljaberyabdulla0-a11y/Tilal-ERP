"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_NAMES,
  Locale,
} from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";

// ============================================================
// مبدّل اللغة.
// يكتب الكوكي ثم يطلب من Next إعادة رسم الشجرة من الخادم — فتتغيّر
// كل الصفحة (النصوص والاتجاه) بلا إعادة تحميل ولا فقدان مكان المستخدم.
// ============================================================
export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [pending, startTransition] = useTransition();

  function pick(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div
      title={t.nav.language}
      className={`inline-flex items-center rounded-xl border border-gray-200 bg-white p-0.5 ${
        pending ? "opacity-60" : ""
      }`}
    >
      {LOCALES.map((code) => (
        <button
          key={code}
          onClick={() => pick(code)}
          disabled={pending}
          lang={code}
          dir={code === "ar" ? "rtl" : "ltr"}
          aria-pressed={code === locale}
          className={
            code === locale
              ? "rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-bold text-white"
              : "rounded-lg px-2.5 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-brand-700"
          }
        >
          {compact ? code.toUpperCase() : LOCALE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}
