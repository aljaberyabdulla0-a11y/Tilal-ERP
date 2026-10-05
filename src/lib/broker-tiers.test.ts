import { describe, it, expect } from "vitest";
import {
  CommissionPlan,
  CommissionPlanTier,
  effectivePlan,
  nextPlanTier,
  planPeriodKey,
  planRate,
  planTiersLabel,
} from "./types";

// يطابق commission_plan_rate و commission_period_key في sql/129 — الواجهة
// تعرض ما تحسبه القاعدة، فإن افترقا كذبت إحداهما.

const plan = (
  id: string,
  over: Partial<CommissionPlan> = {}
): CommissionPlan => ({
  id,
  created_at: "",
  updated_at: "",
  project_id: "P",
  recipient_type: "وسيط",
  company_id: null,
  employee_id: null,
  formula: "شرائح رجعية",
  basis: "عدد الوحدات",
  period: "شهري",
  payable_rule: "بعد تحصيل عمولة تلال",
  is_active: true,
  name: null,
  notes: null,
  ...over,
});

const tier = (
  min: number,
  rate: number | null,
  over: Partial<CommissionPlanTier> = {}
): CommissionPlanTier => ({
  id: `${min}-${rate}-${over.unit_type ?? ""}`,
  plan_id: "x",
  min_units: min,
  min_value: null,
  unit_type: null,
  rate,
  fixed_amount: null,
  ...over,
});

const units = plan("U");
const unitTiers = [tier(6, 1.5), tier(1, 1), tier(11, 2)];

describe("effectivePlan — الخاصة تحلّ محلّ خطة المشروع كلّها", () => {
  const plans = [
    plan("proj"),
    plan("own", { company_id: "X" }),
    plan("old", { is_active: false }),
    plan("emp", { recipient_type: "موظف مباشر" }),
  ];
  it("شركة بلا خطة خاصة تأخذ خطة المشروع", () => {
    expect(effectivePlan(plans, "P", "وسيط", { companyId: "Y" })?.id).toBe("proj");
  });
  it("شركة لها خطة خاصة تأخذها", () => {
    expect(effectivePlan(plans, "P", "وسيط", { companyId: "X" })?.id).toBe("own");
  });
  it("نوع المستفيد يفصل الخطط: البيع المباشر لا يقرأ خطة الوسيط", () => {
    expect(effectivePlan(plans, "P", "موظف مباشر")?.id).toBe("emp");
    expect(effectivePlan(plans, "P", "مدير علاقات")).toBeNull();
  });
  it("الخطة الموقوفة لا تُطبَّق", () => {
    expect(effectivePlan([plan("old", { is_active: false })], "P", "وسيط")).toBeNull();
  });
});

describe("planRate — أعلى شريحة بلغها القياس", () => {
  it("عدد الوحدات: ٥ = ١٪، السادسة = ١.٥٪، الحادية عشرة = ٢٪", () => {
    expect(planRate(units, unitTiers, 1).rate).toBe(1);
    expect(planRate(units, unitTiers, 5).rate).toBe(1);
    expect(planRate(units, unitTiers, 6).rate).toBe(1.5);
    expect(planRate(units, unitTiers, 11).rate).toBe(2);
    expect(planRate(units, unitTiers, 40).rate).toBe(2);
  });
  it("الصفر يُعامل كالوحدة الأولى (greatest(n,1) في القاعدة)", () => {
    expect(planRate(units, unitTiers, 0).rate).toBe(1);
  });
  it("بلا شرائح = صفر", () => {
    expect(planRate(units, [], 3)).toEqual({ rate: 0, fixed: 0 });
  });
  it("أساس القيمة: العتبة مبلغ مبيعات لا عدد", () => {
    const v = plan("V", { basis: "قيمة المبيعات" });
    const t = [
      tier(0, 1, { min_units: null, min_value: 0 }),
      tier(0, 2, { min_units: null, min_value: 150_000_000 }),
    ];
    expect(planRate(v, t, 100_000_000).rate).toBe(1);
    expect(planRate(v, t, 150_000_000).rate).toBe(2);
  });
  it("شرائح نوع الوحدة تحلّ محلّ العامة لذلك النوع وحده", () => {
    const t = [tier(1, 1), tier(1, 3, { unit_type: "فيلا" })];
    expect(planRate(units, t, 1, "فيلا").rate).toBe(3);
    expect(planRate(units, t, 1, "شقة").rate).toBe(1);
  });
  it("المبلغ الثابت يُرجَع مع النسبة (صيغة مختلطة)", () => {
    expect(planRate(units, [tier(1, 0.5, { fixed_amount: 250_000 })], 1)).toEqual({
      rate: 0.5,
      fixed: 250_000,
    });
  });
});

describe("nextPlanTier", () => {
  it("كم باقٍ للشريحة التالية ولأي نسبة", () => {
    expect(nextPlanTier(units, unitTiers, 4)).toEqual({ remaining: 2, rate: 1.5 });
    expect(nextPlanTier(units, unitTiers, 6)).toEqual({ remaining: 5, rate: 2 });
  });
  it("لا تالية بعد الأعلى", () => {
    expect(nextPlanTier(units, unitTiers, 11)).toBeNull();
  });
});

describe("planTiersLabel", () => {
  it("سطرٌ واحد مرتّب بالمدى", () => {
    expect(planTiersLabel(units, unitTiers)).toBe("1–5: 1٪ · 6–10: 1.5٪ · 11+: 2٪");
    expect(planTiersLabel(units, [])).toBe("لا شرائح");
  });
});

describe("planPeriodKey — يطابق commission_period_key", () => {
  const d = new Date("2026-08-15T12:00:00Z");
  it("شهري، ربعي، سنوي، عمر المشروع", () => {
    expect(planPeriodKey("شهري", d)).toBe("2026-08");
    expect(planPeriodKey("ربعي", d)).toBe("2026-Q3");
    expect(planPeriodKey("سنوي", d)).toBe("2026");
    expect(planPeriodKey("عمر المشروع", d)).toBe("الكل");
  });
});
