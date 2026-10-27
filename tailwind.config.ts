import type { Config } from "tailwindcss";

// ============================================================
// إعدادات Tailwind — رموز التصميم (Design Tokens) لهوية «تلال».
//
// الأساس «Emerald Executive» باقٍ كما هو (brand). وأُضيفت فوقه رموزٌ
// دلالية للّوحات وما يتبعها، كي لا تتكرّر قيمٌ عشوائية في الملفات:
//
//   ink       الحبر: نصّ أساسي / ثانوي / خافت
//   surface   الأسطح: بطاقة بيضاء / خلفية فاتحة / غائرة
//   line      الحدود الشعرية
//   success · warning · danger · info   ألوان الحالة — محجوزة للحالة
//             وحدها، لا تُستعمل «سلسلةً رابعة» في رسم.
//   rounded-card · shadow-card          شكل البطاقة الموحّد
//
// ⚠️ ألوان الرسوم (viz) في globals.css متغيّراتٍ — مُتحقَّق منها بمدقّق
//    عمى الألوان: الدخل #047857 والصرف #c2410c (فرقٌ مقبول لكل أنواعه).
// ============================================================
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // نظام تصميم "Emerald Executive"
        // Primary #064E3B • Tertiary #D1FAE5 • Neutral #F9FAFB
        brand: {
          50: "#ecfdf5",
          100: "#d1fae5", // Tertiary (نعناعي فاتح)
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#064e3b", // Primary (الأخضر العميق)
          700: "#053a2c",
          800: "#043024",
          900: "#02261c",
        },
        // Secondary (رمادي داكن) — لعناصر ثانوية
        secondary: {
          700: "#374151",
          800: "#1f2937",
          900: "#111827",
        },
        ink: {
          DEFAULT: "#0f1f1a",
          secondary: "#4b5b55",
          muted: "#86948f",
        },
        surface: {
          DEFAULT: "#ffffff",
          subtle: "#f7f9f8",
          sunken: "#eef3f1",
        },
        line: {
          DEFAULT: "#e4ebe8",
          strong: "#cfd9d5",
        },
        success: { 50: "#ecfdf5", 100: "#d1fae5", 600: "#059669", 700: "#047857" },
        warning: { 50: "#fffbeb", 100: "#fef3c7", 600: "#d97706", 700: "#b45309" },
        danger: { 50: "#fef2f2", 100: "#fee2e2", 600: "#dc2626", 700: "#b91c1c" },
        info: { 50: "#eff6ff", 100: "#dbeafe", 600: "#2563eb", 700: "#1d4ed8" },
        // ⚠️ معاينة التصميم الجديد (/design-preview) وحدها: قيمها متغيّرات
        //    تُعرَّف داخل .tp-root فقط (design-preview/preview.css)، فلا
        //    تؤثّر في أي شاشة قائمة. تُحذف مع المعاينة أو تُرقّى بدل brand.
        tp: {
          forest: {
            950: "rgb(var(--tp-forest-950) / <alpha-value>)",
            900: "rgb(var(--tp-forest-900) / <alpha-value>)",
            800: "rgb(var(--tp-forest-800) / <alpha-value>)",
            700: "rgb(var(--tp-forest-700) / <alpha-value>)",
            600: "rgb(var(--tp-forest-600) / <alpha-value>)",
          },
          mint: {
            300: "rgb(var(--tp-mint-300) / <alpha-value>)",
            100: "rgb(var(--tp-mint-100) / <alpha-value>)",
            50: "rgb(var(--tp-mint-50) / <alpha-value>)",
          },
          paper: "rgb(var(--tp-paper) / <alpha-value>)",
          surface: "rgb(var(--tp-surface) / <alpha-value>)",
          sunken: "rgb(var(--tp-sunken) / <alpha-value>)",
          line: "rgb(var(--tp-line) / <alpha-value>)",
          "line-strong": "rgb(var(--tp-line-strong) / <alpha-value>)",
          ink: "rgb(var(--tp-ink) / <alpha-value>)",
          "ink-2": "rgb(var(--tp-ink-2) / <alpha-value>)",
          "ink-3": "rgb(var(--tp-ink-3) / <alpha-value>)",
          pos: "rgb(var(--tp-pos) / <alpha-value>)",
          "pos-bg": "rgb(var(--tp-pos-bg) / <alpha-value>)",
          neg: "rgb(var(--tp-neg) / <alpha-value>)",
          "neg-bg": "rgb(var(--tp-neg-bg) / <alpha-value>)",
          warn: "rgb(var(--tp-warn) / <alpha-value>)",
          "warn-bg": "rgb(var(--tp-warn-bg) / <alpha-value>)",
          info: "rgb(var(--tp-info) / <alpha-value>)",
          "info-bg": "rgb(var(--tp-info-bg) / <alpha-value>)",
          viz1: "rgb(var(--tp-viz-1) / <alpha-value>)",
          viz2: "rgb(var(--tp-viz-2) / <alpha-value>)",
          vizprev: "rgb(var(--tp-viz-prev) / <alpha-value>)",
        },
      },
      borderRadius: {
        card: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 31, 26, 0.04), 0 1px 3px rgba(15, 31, 26, 0.05)",
        "card-hover": "0 4px 12px -2px rgba(15, 31, 26, 0.08), 0 2px 4px rgba(15, 31, 26, 0.04)",
        sheet: "0 -8px 30px -6px rgba(15, 31, 26, 0.18)",
        // معاينة التصميم: الظلّ للطبقات العائمة وحدها (قوائم، حوارات، إشعارات)
        "tp-overlay": "0 12px 32px -8px rgba(17, 36, 26, 0.20), 0 2px 6px rgba(17, 36, 26, 0.06)",
      },
      fontSize: {
        // أرقام البطاقات: رئيسي / ثانوي / تشغيلي
        "kpi-lg": ["1.75rem", { lineHeight: "2.125rem", fontWeight: "700" }],
        "kpi-md": ["1.375rem", { lineHeight: "1.75rem", fontWeight: "700" }],
        "kpi-sm": ["1.125rem", { lineHeight: "1.5rem", fontWeight: "700" }],
      },
    },
  },
  plugins: [],
};

export default config;
