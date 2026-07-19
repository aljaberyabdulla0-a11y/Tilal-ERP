import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";

// خط عربي عصري (Cairo) — يدعم العربية والإنجليزية
const cairo = Cairo({ subsets: ["arabic", "latin"], display: "swap" });

// البيانات الوصفية للنظام — تظهر بعنوان المتصفح
export const metadata: Metadata = {
  title: "تلال ERP",
  description: "نظام إدارة شركة تلال للتسويق العقاري",
};

// الهيكل الرئيسي لكل صفحات النظام
// lang="ar" و dir="rtl" — عربي افتراضياً، ونضيف التبديل للإنجليزية بمرحلة لاحقة
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={cairo.className}>
      <head>
        {/* أيقونات Material Symbols (نظام تصميم Stitch) */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
