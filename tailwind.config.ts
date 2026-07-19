import type { Config } from "tailwindcss";

// إعدادات Tailwind — ألوان هوية "تلال" ممكن تعديلها لاحقاً
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
      },
    },
  },
  plugins: [],
};

export default config;
