import { describe, it, expect } from "vitest";
import {
  BrokerCommissionTier,
  currentPeriod,
  effectiveTiers,
  loginToEmail,
  nextTier,
  tierRate,
  tiersLabel,
} from "./types";

// يطابق broker_tier_rate في sql/117 — الواجهة تعرض ما تحسبه القاعدة
const tier = (
  project_id: string,
  company_id: string | null,
  min_units: number,
  rate: number
): BrokerCommissionTier => ({
  id: `${project_id}-${company_id}-${min_units}`,
  project_id,
  company_id,
  min_units,
  rate,
  created_at: "",
});

const tiers = [
  tier("P", null, 6, 1.5),
  tier("P", null, 1, 1),
  tier("P", null, 11, 2),
  tier("P", "X", 1, 2.5),
  tier("Q", null, 1, 0.5),
];

describe("effectiveTiers — الخاصة تحلّ محلّ شرائح المشروع كلّها", () => {
  it("شركة بلا شرائح خاصة تأخذ شرائح المشروع مرتّبة", () => {
    expect(effectiveTiers(tiers, "P", "Y").map((t) => t.min_units)).toEqual([1, 6, 11]);
  });
  it("شركة لها صفٌّ خاص واحد لا تخلط معه شرائح المشروع", () => {
    expect(effectiveTiers(tiers, "P", "X").map((t) => t.rate)).toEqual([2.5]);
  });
  it("شرائح مشروع آخر لا تتسرّب", () => {
    expect(effectiveTiers(tiers, "Q", "X").map((t) => t.rate)).toEqual([0.5]);
  });
});

describe("tierRate — أعلى شريحة بلغها عدد الشهر", () => {
  const eff = effectiveTiers(tiers, "P", "Y");
  it("الحدود", () => {
    expect(tierRate(eff, 1)).toBe(1);
    expect(tierRate(eff, 5)).toBe(1);
    expect(tierRate(eff, 6)).toBe(1.5);
    expect(tierRate(eff, 11)).toBe(2);
    expect(tierRate(eff, 40)).toBe(2);
  });
  it("صفر وحدات يُعامل كالأولى (كما في القاعدة greatest(n,1))", () => {
    expect(tierRate(eff, 0)).toBe(1);
  });
  it("بلا شرائح = صفر", () => {
    expect(tierRate([], 3)).toBe(0);
  });
});

describe("nextTier", () => {
  const eff = effectiveTiers(tiers, "P", "Y");
  it("كم باقٍ للشريحة التالية", () => {
    expect(nextTier(eff, 4)).toEqual({ remaining: 2, rate: 1.5 });
    expect(nextTier(eff, 6)).toEqual({ remaining: 5, rate: 2 });
  });
  it("بلغ الأعلى", () => {
    expect(nextTier(eff, 11)).toBeNull();
  });
});

describe("tiersLabel", () => {
  it("مدى كل شريحة", () => {
    expect(tiersLabel(effectiveTiers(tiers, "P", "Y"))).toBe("1–5: 1٪ · 6–10: 1.5٪ · 11+: 2٪");
    expect(tiersLabel([])).toBe("لا شرائح");
  });
});

describe("loginToEmail — اسم مستخدم الوسيط", () => {
  it("البريد يبقى كما هو بأحرف صغيرة", () => {
    expect(loginToEmail(" Ali@Mail.com ")).toBe("ali@mail.com");
  });
  it("اسم المستخدم يصير بريداً داخلياً على .invalid", () => {
    expect(loginToEmail("Ali.Sarai")).toBe("ali.sarai@brokers.tilal.invalid");
  });
});

describe("currentPeriod — شهر بغداد لا شهر الخادم", () => {
  it("منتصف ليل UTC آخر الشهر هو أول الشهر التالي في بغداد", () => {
    expect(currentPeriod(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10");
    expect(currentPeriod(new Date("2026-09-30T20:00:00Z"))).toBe("2026-09");
  });
});
