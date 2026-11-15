import { describe, expect, it } from "vitest";
import {
  FOLLOWUP_DAY_OFF_MSG,
  arDayName,
  followupDayHint,
  isFollowupDayOff,
} from "./followup-rules";
import { buildActivityPayload, newActivityForm } from "./activity-form";

const status = (over: Partial<Parameters<typeof followupDayHint>[1] & object> = {}) => ({
  day_off: false,
  count: 0,
  cap: 30,
  full: false,
  next_free: null,
  next_free_day: null,
  ...over,
});

describe("isFollowupDayOff", () => {
  it("الجمعة عطلة وباقي الأيام لا", () => {
    expect(isFollowupDayOff("2026-11-20")).toBe(true); // جمعة
    expect(isFollowupDayOff("2026-11-19")).toBe(false); // خميس
    expect(isFollowupDayOff("2026-11-21")).toBe(false); // سبت
  });

  it("مدخل فارغ أو غير تاريخ ليس عطلة", () => {
    expect(isFollowupDayOff("")).toBe(false);
    expect(isFollowupDayOff(null)).toBe(false);
    expect(isFollowupDayOff("غداً")).toBe(false);
  });

  it("اسم اليوم بالعربية", () => {
    expect(arDayName("2026-11-20")).toBe("الجمعة");
    expect(arDayName("2026-11-15")).toBe("الأحد");
  });
});

describe("followupDayHint", () => {
  it("الجمعة تُمنع حتى بلا حالة من القاعدة", () => {
    expect(followupDayHint("2026-11-20", null)).toEqual({
      tone: "block",
      text: FOLLOWUP_DAY_OFF_MSG,
      suggest: null,
    });
  });

  it("الجمعة تقترح أقرب يوم متاح إن وصل", () => {
    const h = followupDayHint("2026-11-20", status({ day_off: true, next_free: "2026-11-21" }));
    expect(h?.suggest).toBe("2026-11-21");
  });

  it("يوم ممتلئ يُمنع ويقترح بديلاً", () => {
    const h = followupDayHint("2026-11-17", status({ count: 30, full: true, next_free: "2026-11-18" }));
    expect(h?.tone).toBe("block");
    expect(h?.text).toContain("ممتلئ");
    expect(h?.text).toContain("30");
    expect(h?.suggest).toBe("2026-11-18");
  });

  it("يوم فيه متّسع: عدّاد، ويحذّر قرب الامتلاء", () => {
    expect(followupDayHint("2026-11-17", status({ count: 12 }))?.tone).toBe("ok");
    expect(followupDayHint("2026-11-17", status({ count: 12 }))?.text).toContain("بقي 18");
    expect(followupDayHint("2026-11-17", status({ count: 27 }))?.tone).toBe("warn");
  });

  it("بلا تاريخ أو بلا حالة: لا تنبيه", () => {
    expect(followupDayHint("", null)).toBeNull();
    expect(followupDayHint("2026-11-17", null)).toBeNull();
  });
});

describe("buildActivityPayload — الجمعة", () => {
  const form = (next_date: string) => ({
    ...newActivityForm("مكالمة"),
    date: "2026-11-15",
    time: "10:00",
    next_date,
  });

  it("موعد متابعة في الجمعة يُرفض", () => {
    expect(buildActivityPayload(form("2026-11-20"), "اتصال")).toEqual({
      error: FOLLOWUP_DAY_OFF_MSG,
    });
  });

  it("يوم آخر يُقبل", () => {
    expect("payload" in buildActivityPayload(form("2026-11-21"), "اتصال")).toBe(true);
  });

  it("تعديل سجلّ قديم موعده جمعة ولم يتغيّر: يُقبل", () => {
    expect(
      "payload" in buildActivityPayload(form("2026-11-20"), "اتصال", "2026-11-20")
    ).toBe(true);
  });

  it("ملف مغلق: لا موعد أصلاً فلا فحص", () => {
    expect("payload" in buildActivityPayload(form("2026-11-20"), "بيع")).toBe(true);
  });
});
