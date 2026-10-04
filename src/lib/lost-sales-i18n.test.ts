import { describe, expect, it } from "vitest";
import {
  bandLabel, compactMoney, insightText, lostDict, milestoneLabel, outcomeLabel, pick, PRICE_BANDS, type Insight,
} from "./lost-sales-i18n";

// الصياغة وحدها تُختبر هنا — الأرقام والعتبات في القاعدة (sql/141) وتُختبر في tests.run_lost_sales()

const cat = (c: string | null | undefined) => (c === "price" ? "السعر" : String(c));

describe("lostDict — اللغتان متطابقتا المفاتيح", () => {
  it("لكل مفتاح عربي نصٌّ إنجليزي غير فارغ", () => {
    const ar = lostDict("ar");
    const en = lostDict("en");
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    for (const k of Object.keys(en)) expect((en as Record<string, string>)[k].length).toBeGreaterThan(0);
  });
});

describe("compactMoney — القيم الكبيرة مختصرة", () => {
  it("المليارات والملايين", () => {
    expect(compactMoney(18_400_000_000, "en")).toBe("18.4B");
    expect(compactMoney(350_000_000, "en")).toBe("350M");
    expect(compactMoney(350_000_000, "ar")).toBe("350 مليون");
  });
  it("الفارغ «—» لا صفر", () => {
    expect(compactMoney(null, "ar")).toBe("—");
    expect(compactMoney(undefined, "en")).toBe("—");
  });
});

describe("الرموز الثابتة", () => {
  it("كل شريحة سعر لها اسم بلغتين", () => {
    for (const b of PRICE_BANDS) {
      expect(bandLabel(b, "ar")).not.toBe(b);
      expect(bandLabel(b, "en")).not.toBe(b);
    }
  });
  it("رمزٌ مجهول يُعرض كما هو لا يُخفى", () => {
    expect(milestoneLabel("future_code", "ar")).toBe("future_code");
    expect(outcomeLabel(null, "en")).toBe("—");
  });
  it("pick يسقط إلى اللغة الأخرى حين يغيب الاسم", () => {
    expect(pick({ name_ar: "السعر", name_en: null }, "en")).toBe("السعر");
    expect(pick({ name_ar: "السعر", name_en: "Price" }, "en")).toBe("Price");
  });
});

describe("insightText — الرؤى تُصاغ من معاملاتها", () => {
  it("السبب الأول في ٣٠ يوماً", () => {
    const ins: Insight = { code: "top_reason_30d", level: "warn", params: { code: "price", share: 32, n: 16, total: 50 } };
    expect(insightText(ins, "ar", cat)).toContain("«السعر» هو السبب الرئيسي");
    expect(insightText(ins, "en", cat)).toContain("32%");
  });
  it("المنافس بقيمته المختصرة", () => {
    const ins: Insight = { code: "competitor_impact", level: "risk", params: { name: "X", n: 18, value: 6_200_000_000 } };
    expect(insightText(ins, "en", cat)).toBe("Competitor X caused 18 lost opportunities with an estimated lost value of 6.2B IQD.");
  });
  it("تغيّر الحصّة يقول الاتجاه", () => {
    const up: Insight = { code: "reason_shift", level: "warn", params: { code: "price", prev_share: 20, cur_share: 38, diff: 18 } };
    const down: Insight = { code: "reason_shift", level: "info", params: { code: "price", prev_share: 38, cur_share: 20, diff: -18 } };
    expect(insightText(up, "ar", cat)).toContain("ارتفعت 18");
    expect(insightText(down, "en", cat)).toContain("decreased by 18");
  });
  it("رمز رؤية مجهول لا يكسر الشاشة", () => {
    expect(insightText({ code: "new_rule", level: "info", params: {} }, "ar", cat)).toBe("new_rule");
  });
});
