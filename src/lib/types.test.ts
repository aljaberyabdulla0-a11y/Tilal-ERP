import { describe, it, expect } from "vitest";
import {
  sinceColor,
  DEFAULT_SILENCE,
  isSystemActivity,
  isClosedStage,
  nameKey,
  SYSTEM_ACTIVITY_TYPES,
} from "./types";

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

describe("sinceColor — عتبات الصمت من الإعدادات لا من الكود", () => {
  it("الافتراض ٧/٢١ يطابق السلوك القديم حرفياً", () => {
    expect(DEFAULT_SILENCE).toEqual({ green: 7, amber: 21 });
    expect(sinceColor(daysAgo(0))).toBe("text-green-700");
    expect(sinceColor(daysAgo(7))).toBe("text-green-700");
    expect(sinceColor(daysAgo(8))).toBe("text-amber-600");
    expect(sinceColor(daysAgo(21))).toBe("text-amber-600");
    expect(sinceColor(daysAgo(22))).toBe("text-red-600");
  });

  it("العتبات الممرَّرة من crm_settings تحكم", () => {
    const strict = { green: 2, amber: 5 };
    expect(sinceColor(daysAgo(3), strict)).toBe("text-amber-600");
    expect(sinceColor(daysAgo(6), strict)).toBe("text-red-600");
  });

  it("بلا تواصل قطّ = أحمر", () => {
    expect(sinceColor(null)).toBe("text-red-600");
    expect(sinceColor(undefined)).toBe("text-red-600");
  });
});

describe("isSystemActivity — مرآة public.is_system_activity (sql/045 · 072)", () => {
  it("الأنواع النظامية الثلاثة لا تُحتسب تواصلاً", () => {
    expect(isSystemActivity("تغيير مرحلة")).toBe(true);
    expect(isSystemActivity("تسليم")).toBe(true);
    expect(isSystemActivity("حجز")).toBe(true);
    expect(SYSTEM_ACTIVITY_TYPES.map((t) => t.key).sort()).toEqual(["تسليم", "تغيير مرحلة", "حجز"].sort());
  });
  it("التواصل الفعلي ليس نظامياً", () => {
    expect(isSystemActivity("مكالمة")).toBe(false);
    expect(isSystemActivity("ملاحظة")).toBe(false);
  });
});

describe("isClosedStage", () => {
  it("بيع وفشل البيع مغلقتان؛ الفارغ يُعامل كـ«ليد»", () => {
    expect(isClosedStage("بيع")).toBe(true);
    expect(isClosedStage("فشل البيع")).toBe(true);
    expect(isClosedStage("اتصال")).toBe(false);
    expect(isClosedStage(null)).toBe(false);
  });
});

describe("nameKey — مرآة public.name_key (sql/032)", () => {
  it("يطبّع المسافات وحالة الأحرف فقط", () => {
    expect(nameKey("  ريتا   ماجد ")).toBe("ريتا ماجد");
    expect(nameKey("Rita MAJED")).toBe("rita majed");
    expect(nameKey(null)).toBe("");
  });
});
