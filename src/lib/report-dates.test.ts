import { describe, it, expect } from "vitest";
import {
  addDays, addMonths, autoGrain, baghdadToday, bucketKeys, comparisonRange,
  daysBetween, enumerateDays, isIsoDate, resolvePreset, resolveRange, weekStart,
} from "./report-dates";

const today = "2026-09-27"; // أحد

describe("مرآة crm_resolve_range (099) — نفس الأجوبة التي أعطتها القاعدة الحيّة يوم ٢٠٢٦-٠٩-٢٧", () => {
  it("أمس", () => expect(resolvePreset("yesterday", { today })).toEqual({ from: "2026-09-26", to: "2026-09-26" }));
  it("هذا الأسبوع يبدأ السبت (week_start_dow = 6)", () =>
    expect(resolvePreset("this_week", { today })).toEqual({ from: "2026-09-26", to: "2026-09-27" }));
  it("الشهر الماضي", () => expect(resolvePreset("last_month", { today })).toEqual({ from: "2026-08-01", to: "2026-08-31" }));
  it("الربع الماضي", () => expect(resolvePreset("last_quarter", { today })).toEqual({ from: "2026-04-01", to: "2026-06-30" }));
  it("آخر ٧ أيام تشمل اليوم", () => expect(resolvePreset("last_7", { today })).toEqual({ from: "2026-09-21", to: today }));
});

describe("الاختصارات والمدى المخصّص (§15)", () => {
  it("آخر ١٧ يوماً — عدد أيام حرّ", () => {
    const r = resolveRange("last_n", { today, n: 17 });
    expect(r).toMatchObject({ from: "2026-09-11", to: today, days: 17, label: "آخر 17 يوماً" });
  });
  it("من ٥ إلى ١٩ سبتمبر", () => {
    const r = resolveRange("custom", { today, from: "2026-09-05", to: "2026-09-19" });
    expect(r).toMatchObject({ from: "2026-09-05", to: "2026-09-19", days: 15 });
  });
  it("مدى مقلوب يُصحَّح لا يُرفض", () =>
    expect(resolvePreset("custom", { today, from: "2026-09-19", to: "2026-09-05" })).toEqual({ from: "2026-09-05", to: "2026-09-19" }));
  it("تاريخ مستحيل يُرفض", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
  });
  it("الأسبوع الماضي سبعة أيام من سبت إلى جمعة", () => {
    const r = resolvePreset("last_week", { today });
    expect(r).toEqual({ from: "2026-09-19", to: "2026-09-25" });
    expect(daysBetween(r.from, r.to) + 1).toBe(7);
  });
  it("بداية الأسبوع تتبع الإعداد — الاثنين إن اختير ١", () => expect(weekStart(today, 1)).toBe("2026-09-21"));
});

describe("فترة المقارنة (§24)", () => {
  it("مثال الطلب حرفياً: ١–١٥ سبتمبر ← ١٧–٣١ أغسطس", () =>
    expect(comparisonRange({ from: "2026-09-01", to: "2026-09-15" }, "previous_period")).toEqual({ from: "2026-08-17", to: "2026-08-31" }));

  it("شهر كامل ← الشهر الكامل قبله (أغسطس ← يوليو، لا ٣١ يوماً)", () =>
    expect(comparisonRange({ from: "2026-08-01", to: "2026-08-31" }, "previous_period")).toEqual({ from: "2026-07-01", to: "2026-07-31" }));

  it("«هذا الشهر» حتى اليوم ← نفس الأيام من الشهر السابق", () =>
    expect(comparisonRange({ from: "2026-09-01", to: "2026-09-27" }, "previous_period", "this_month")).toEqual({ from: "2026-08-01", to: "2026-08-27" }));

  it("«هذا الشهر» يوم ٣١ مارس ← يُقصّ إلى آخر فبراير", () =>
    expect(comparisonRange({ from: "2026-03-01", to: "2026-03-31" }, "previous_period", "this_month")).toEqual({ from: "2026-02-01", to: "2026-02-28" }));

  it("مارس كاملاً مدىً مخصّصاً ← فبراير كاملاً", () =>
    expect(comparisonRange({ from: "2026-03-01", to: "2026-03-31" }, "previous_period")).toEqual({ from: "2026-02-01", to: "2026-02-28" }));

  it("يوم بيوم", () =>
    expect(comparisonRange({ from: today, to: today }, "previous_period")).toEqual({ from: "2026-09-26", to: "2026-09-26" }));

  it("أسبوع بأسبوع", () =>
    expect(comparisonRange({ from: "2026-09-19", to: "2026-09-25" }, "previous_period")).toEqual({ from: "2026-09-12", to: "2026-09-18" }));

  it("ربع بربع", () =>
    expect(comparisonRange({ from: "2026-04-01", to: "2026-06-30" }, "previous_period")).toEqual({ from: "2026-01-01", to: "2026-03-31" }));

  it("هذه السنة ← السنة الماضية حتى نفس اليوم", () =>
    expect(comparisonRange({ from: "2026-01-01", to: "2026-02-10" }, "previous_period", "this_year")).toEqual({ from: "2025-01-01", to: "2025-02-10" }));

  it("سنة بسنة", () =>
    expect(comparisonRange({ from: "2026-09-01", to: "2026-09-15" }, "previous_year")).toEqual({ from: "2025-09-01", to: "2025-09-15" }));

  it("بلا مقارنة", () => expect(comparisonRange({ from: today, to: today }, "none")).toBeNull());
});

describe("الحساب والتجزئة", () => {
  it("إضافة الأيام تعبر الأشهر والسنوات", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });
  it("إضافة الأشهر تقصّ آخر الشهر", () => expect(addMonths("2026-01-31", 1)).toBe("2026-02-28"));
  it("الأيام بالتسلسل كاملة", () => expect(enumerateDays("2026-09-01", "2026-09-03")).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]));
  it("التجزئة تناسب طول المدى", () => {
    expect(autoGrain({ from: "2026-09-01", to: "2026-09-30" })).toBe("day");
    expect(autoGrain({ from: "2026-04-01", to: "2026-09-30" })).toBe("week");
    expect(autoGrain({ from: "2025-01-01", to: "2026-09-27" })).toBe("month");
  });
  it("مفاتيح الأسابيع ببداياتها بلا تكرار", () =>
    expect(bucketKeys({ from: "2026-09-19", to: "2026-09-27" }, "week")).toEqual(["2026-09-19", "2026-09-26"]));
});

describe("حدود اليوم بتوقيت بغداد (§85)", () => {
  it("٢٣:٥٩ بغداد = نفس اليوم رغم أنها ٢٠:٥٩ UTC", () =>
    expect(baghdadToday(new Date("2026-09-01T20:59:00Z"))).toBe("2026-09-01"));
  it("٠٠:٠١ بغداد = اليوم التالي رغم أنها ما زالت ٢١:٠١ UTC من اليوم السابق", () =>
    expect(baghdadToday(new Date("2026-09-01T21:01:00Z"))).toBe("2026-09-02"));
});
