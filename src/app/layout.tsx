import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import { dirOf } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";

// خط عربي عصري (Cairo) — يدعم العربية والإنجليزية بمجموعة حروف واحدة،
// فلا نحتاج خطاً ثانياً عند التبديل ولا رحلة شبكة إضافية.
const cairo = Cairo({ subsets: ["arabic", "latin"], display: "swap" });

// البيانات الوصفية للنظام — تظهر بعنوان المتصفح
export const metadata: Metadata = {
  title: "تلال ERP · Tilal ERP",
  description: "نظام إدارة شركة تلال للتسويق العقاري — Tilal Real Estate ERP",
};

// ============================================================
// الهيكل الرئيسي لكل صفحات النظام.
// اللغة والاتجاه يُقرآن من الكوكي هنا مرة واحدة، فيخرج أول رسم من
// الخادم صحيحاً بلا وميض ولا قفزة في الاتجاه.
// ============================================================
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { locale, t } = getI18n();

  return (
    <html lang={locale} dir={dirOf(locale)} className={cairo.className}>
      <head>
        {/* نفتح الاتصال بخادم الخطوط مبكراً حتى لا يؤخّر تحميلُ الأيقونات
            أول رسم للصفحة (توفير جولة DNS/TLS كاملة) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* أيقونات Material Symbols (نظام تصميم Stitch) */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
        />
      </head>
      <body>
        <I18nProvider locale={locale} dictionary={t}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
