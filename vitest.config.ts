import { defineConfig } from "vitest/config";
import path from "node:path";

// ============================================================
// اختبارات المنطق الخالص (§65). ما يعمل خارج Next وSupabase وحده
// يُختبر هنا: التطبيع، والتحقّق، وتقسيم المتابعات، وعتبات الصمت.
// السياسات والمحفّزات تُختبر على القاعدة (pgTAP — لم يُؤسَّس بعد).
// ============================================================
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
