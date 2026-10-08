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
      },
      borderRadius: {
        card: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 31, 26, 0.04), 0 1px 3px rgba(15, 31, 26, 0.05)",
        "card-hover": "0 4px 12px -2px rgba(15, 31, 26, 0.08), 0 2px 4px rgba(15, 31, 26, 0.04)",
        sheet: "0 -8px 30px -6px rgba(15, 31, 26, 0.18)",
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
