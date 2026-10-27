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
      role="group"
      aria-label={t.nav.language}
      title={t.nav.language}
      className={`inline-flex items-center rounded-md bg-surface-sunken p-0.5 ${
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
              ? "dash-focus rounded-[5px] bg-surface px-2.5 py-1 text-xs font-bold text-brand-700 shadow-[0_1px_2px_rgba(17,36,26,0.08)]"
              : "dash-focus rounded-[5px] px-2.5 py-1 text-xs font-semibold text-ink-secondary transition hover:text-ink"
          }
        >
          {compact ? (code === "ar" ? "ع" : "EN") : LOCALE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}
