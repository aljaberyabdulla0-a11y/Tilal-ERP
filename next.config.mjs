/** @type {import('next').NextConfig} */
// إعدادات Next.js الأساسية — راح نضيف إعدادات اللغات لاحقاً
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // exceljs مكتبة Node تقليدية (CommonJS مع اعتماديات نظام الملفات)،
    // نتركها تُحمَّل وقت التشغيل بدل ما يحاول webpack تحزيمها — وإلا
    // يفشل بناء مسارات الاكسل برسالة "Cannot find module for page".
    serverComponentsExternalPackages: ["exceljs"],
  },
};

export default nextConfig;
