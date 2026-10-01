import { describe, it, expect } from "vitest";
import {
  ENTRY_TEMPLATES,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  categoriesFor,
  findCategory,
  retiredCategoriesFor,
} from "./types";
import { toMoneyOverview } from "./money-overview";

// الحسابات التي لها مسارٌ آلي — حركة أو قالب يدوي عليها يكرّر الرقم (sql/109)
const AUTOMATIC_ONLY = ["4100", "4200", "5100", "5500", "2400"];

describe("تصنيفات الحركات — نموذج الوساطة (sql/109)", () => {
  it("لا تصنيف متاح لحركة جديدة يكتب على حسابٍ له مسار آلي", () => {
    for (const d of ["صرف", "قبض"] as const) {
      for (const c of categoriesFor(d)) {
        expect(AUTOMATIC_ONLY).not.toContain(c.account);
      }
    }
  });

  it("التصنيفات الموقوفة الأربعة موجودة بسببها وبديلها", () => {
    const retired = [...retiredCategoriesFor("صرف"), ...retiredCategoriesFor("قبض")].map((c) => c.label);
    expect(retired.sort()).toEqual(["بيع عقار أو وحدة", "رواتب وأجور", "عمولات مدفوعة", "عمولة عقارية"].sort());
    for (const c of [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].filter((x) => x.retired)) {
      expect(c.retired!.why.length).toBeGreaterThan(10);
      expect(c.retired!.instead.length).toBeGreaterThan(10);
    }
  });

  it("الحركة القديمة بتصنيف موقوف ما زالت تُقرأ", () => {
    expect(findCategory("صرف", "رواتب وأجور")?.account).toBe("5100");
    expect(findCategory("قبض", "بيع عقار أو وحدة")?.account).toBe("4100");
  });

  it("الأجر اليومي له حسابه المستقلّ عن رواتب الكشوف", () => {
    expect(findCategory("صرف", "أجور يومية ومستقلون")?.account).toBe("5110");
  });

  it("قوالب القيد اليدوي لا تمسّ الإيراد ولا الرواتب ولا العربون ولا ذمم العملاء", () => {
    for (const t of ENTRY_TEMPLATES) {
      expect([...AUTOMATIC_ONLY, "1300"]).not.toContain(t.debit);
      expect([...AUTOMATIC_ONLY, "1300"]).not.toContain(t.credit);
      expect(t.debit).not.toBe(t.credit);
    }
  });
});

describe("الملخّص المالي من القاعدة (money_overview — sql/112)", () => {
  it("يحوّل الأرقام والأشهر ويحسب الصافي", () => {
    const o = toMoneyOverview({
      cash: 1655000,
      income: 13537000,
      expense: 14503185,
      payrollDue: 3214000,
      developerDue: 11237000,
      byCategory: [{ label: "الرواتب", amount: 11398015 }],
      months: [
        { key: "2026-08", income: 0, expense: 7317285 },
        { key: "2026-09", income: 13537000, expense: 5764900 },
      ],
    });
    expect(o.net).toBe(13537000 - 14503185);
    expect(o.developerDue).toBe(11237000);
    expect(o.months.map((m) => m.label)).toEqual(["آب", "أيلول"]);
    expect(o.partnerDue).toBe(0);
    expect(o.byArm).toEqual([]);
  });

  it("يقبل الأرقام نصوصاً كما قد يعيدها PostgREST للنوع numeric", () => {
    const o = toMoneyOverview({ cash: "455000.00" as unknown as number });
    expect(o.cash).toBe(455000);
  });
});
