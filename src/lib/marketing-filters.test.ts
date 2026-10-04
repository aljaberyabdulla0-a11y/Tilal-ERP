import { describe, expect, it } from "vitest";
import { parseMktFilters, presetRange, previousRange, withParams } from "./marketing-filters";

const ID = "6f1c2b3a-1111-4222-8333-944455566677";

describe("presetRange — حدود الفترات بلا ساعة", () => {
  it("الشهر من أوّله إلى اليوم", () => {
    expect(presetRange("month", "2026-10-04")).toEqual({ from: "2026-10-01", to: "2026-10-04" });
  });
  it("الربع الرابع يبدأ أكتوبر", () => {
    expect(presetRange("quarter", "2026-11-20")).toEqual({ from: "2026-10-01", to: "2026-11-20" });
  });
  it("الربع الأول يبدأ يناير", () => {
    expect(presetRange("quarter", "2026-03-31").from).toBe("2026-01-01");
  });
  it("آخر ٣٠ يوماً تشمل اليوم وعبور السنة", () => {
    expect(presetRange("last30", "2026-01-10")).toEqual({ from: "2025-12-12", to: "2026-01-10" });
  });
  it("كل الوقت بلا حدّين", () => {
    expect(presetRange("all", "2026-10-04")).toEqual({ from: null, to: null });
  });
});

describe("previousRange — الفترة السابقة بنفس الطول", () => {
  it("شهر سبتمبر (٣٠ يوماً) يقابله ما قبله ٣٠ يوماً", () => {
    expect(previousRange("2026-09-01", "2026-09-30")).toEqual({ from: "2026-08-02", to: "2026-08-31" });
  });
  it("يومٌ واحد يقابله اليوم السابق", () => {
    expect(previousRange("2026-03-01", "2026-03-01")).toEqual({ from: "2026-02-28", to: "2026-02-28" });
  });
});

describe("parseMktFilters — من الرابط إلى معاملات 125", () => {
  it("الافتراضي هذا الشهر ولا يُحمَل في الرابط", () => {
    const f = parseMktFilters({}, "2026-10-04");
    expect(f.preset).toBe("month");
    expect(f.from).toBe("2026-10-01");
    expect(f.params).toEqual({});
  });
  it("التاريخ الصريح يغلب الاختصار، والمعكوس يُصحَّح", () => {
    const f = parseMktFilters({ range: "year", from: "2026-09-30", to: "2026-09-01" }, "2026-10-04");
    expect(f.preset).toBe("custom");
    expect([f.from, f.to]).toEqual(["2026-09-01", "2026-09-30"]);
  });
  it("المعرّف الفاسد يُسقط ولا يصل القاعدة", () => {
    const f = parseMktFilters({ project: "1; drop table x", campaign: ID }, "2026-10-04");
    expect(f.project).toBeNull();
    expect(f.campaign).toBe(ID);
    expect(f.params).toEqual({ campaign: ID });
  });
  it("نموذج إسناد غير معروف يعود last", () => {
    expect(parseMktFilters({ model: "magic" }, "2026-10-04").model).toBe("last");
    expect(parseMktFilters({ model: "time_decay" }, "2026-10-04").params.model).toBe("time_decay");
  });
  it("تاريخ بصيغة خاطئة يُتجاهل", () => {
    const f = parseMktFilters({ from: "01/09/2026" }, "2026-10-04");
    expect(f.preset).toBe("month");
  });
});

describe("withParams", () => {
  it("يضيف ويحذف دون أن يُسقط الباقي", () => {
    expect(withParams("/x", { a: "1", b: "2" }, { b: null, c: "3" })).toBe("/x?a=1&c=3");
    expect(withParams("/x", {})).toBe("/x");
  });
});
