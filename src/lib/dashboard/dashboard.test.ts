import { describe, expect, it } from "vitest";
import { dayPart, fill, fmtBucket, fmtMoney, fmtPct, fmtRelative, fmtValue } from "./format";
import { alignByIndex, dashQuery, drillHref, engineFilters, parseDashFilters } from "./period";
import { countStatus, makeKpi, rankProjects, sellThrough } from "./kpi";

const UUID = "11111111-2222-4333-8444-555555555555";
const UUID2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("التحية بساعة بغداد لا بساعة الخادم (L1)", () => {
  it("الواحدة ظهراً في بغداد (10:00 UTC) ليست صباحاً", () => {
    expect(dayPart(new Date("2026-10-07T10:00:00Z"))).toBe("afternoon");
  });
  it("الثامنة صباحاً في بغداد (05:00 UTC) صباح", () => {
    expect(dayPart(new Date("2026-10-07T05:00:00Z"))).toBe("morning");
  });
  it("العاشرة ليلاً في بغداد (19:00 UTC) مساء", () => {
    expect(dayPart(new Date("2026-10-07T19:00:00Z"))).toBe("evening");
  });
  it("منتصف ليل UTC هو الثالثة فجراً في بغداد — ليس صباحاً بعد", () => {
    expect(dayPart(new Date("2026-10-07T00:00:00Z"))).toBe("evening");
  });
});

describe("التنسيق حسب اللغة", () => {
  it("المبلغ المختصر بأرقام لاتينية في اللغتين والعملة حسب اللغة", () => {
    expect(fmtMoney(245_800_000, "en", "IQD")).toBe("IQD 245.8M");
    const ar = fmtMoney(245_800_000, "ar", "د.ع");
    expect(ar).toMatch(/245\.8/);
    expect(ar.endsWith("د.ع")).toBe(true);
    expect(ar).not.toMatch(/[٠-٩]/);
  });
  it("العربية: الرقم معزول (LRI…PDI) قبل كلمة الاختصار والعملة — فلا ينقلب ترتيبها", () => {
    expect(fmtMoney(245_800_000, "ar", "د.ع")).toBe("⁦245.8⁩ مليون د.ع");
    expect(fmtMoney(-966_185, "ar", "د.ع")).toMatch(/^⁦-966/);
    expect(fmtPct(18.44, "ar")).toBe("⁦18.4%⁩");
    expect(fmtMoney(245_800_000, "en", "IQD")).not.toMatch(/⁦/);
  });
  it("المبالغ الصغيرة لا تُختصر", () => {
    expect(fmtMoney(9500, "en", "IQD")).toBe("IQD 9,500");
  });
  it("القيمة الغائبة شرطة لا صفر", () => {
    expect(fmtMoney(null, "en", "IQD")).toBe("—");
    expect(fmtPct(undefined, "ar")).toBe("—");
    expect(fmtValue(null, "count", "en", { currency: "IQD", days: "days" })).toBe("—");
  });
  it("الأيام والنسب والمضاعف", () => {
    expect(fmtValue(12.34, "days", "en", { currency: "IQD", days: "days" })).toBe("12.3 days");
    expect(fmtValue(18.44, "pct", "en", { currency: "IQD", days: "days" })).toBe("18.4%");
    expect(fmtValue(3.456, "ratio", "en", { currency: "IQD", days: "days" })).toBe("3.46×");
  });
  it("تسمية الشهر في المحور", () => {
    expect(fmtBucket("2026-10", "month", "en")).toBe("Oct 26");
  });
  it("الوقت النسبي", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(fmtRelative("2026-10-07T11:48:00Z", "en", now)).toBe("12 minutes ago");
    expect(fmtRelative("2026-10-06T12:00:00Z", "en", now)).toBe("yesterday");
  });
  it("القالب يملأ المتغيّرات ويُبقي المجهول", () => {
    expect(fill("{n} من {total} {x}", { n: 3, total: 9 })).toBe("3 من 9 {x}");
  });
});

describe("مُرشِّحات اللوحة من الرابط", () => {
  const today = "2026-10-07";

  it("الافتراضي: هذا الشهر حتى اليوم ومقارنته بنفس الموضع من الشهر السابق", () => {
    const f = parseDashFilters({}, { today });
    expect(f.preset).toBe("this_month");
    expect(f.range).toMatchObject({ from: "2026-10-01", to: "2026-10-07" });
    expect(f.previous).toEqual({ from: "2026-09-01", to: "2026-09-07" });
    expect(f.grain).toBe("day");
  });

  it("الشهر الماضي يُقارن بالشهر الكامل قبله", () => {
    const f = parseDashFilters({ range: "last_month" }, { today });
    expect(f.range).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(f.previous).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("هذا العام يُقارن بالعام الماضي حتى نفس اليوم ويُجزَّأ شهرياً", () => {
    const f = parseDashFilters({ range: "this_year" }, { today });
    expect(f.previous).toEqual({ from: "2025-01-01", to: "2025-10-07" });
    expect(f.grain).toBe("month");
  });

  it("المدى المخصّص يغلب الاختصار، والمقلوب يُصحَّح", () => {
    const f = parseDashFilters({ range: "this_year", from: "2026-09-15", to: "2026-09-01" }, { today });
    expect(f.preset).toBe("custom");
    expect(f.range).toMatchObject({ from: "2026-09-01", to: "2026-09-15" });
  });

  it("اختصارٌ غير معروف يرجع للافتراضي — لا يُكسر", () => {
    expect(parseDashFilters({ range: "drop table" }, { today }).preset).toBe("this_month");
  });

  it("المشروع والفريق والمصدر معرّفات UUID فقط", () => {
    const f = parseDashFilters({ project: UUID, team: "x'; --", source: UUID2 }, { today });
    expect(f.project).toBe(UUID);
    expect(f.team).toBeNull();
    expect(engineFilters(f)).toEqual({ project: [UUID], source: [UUID2] });
  });

  it("الحبّة من الرابط تغلب التلقائية", () => {
    expect(parseDashFilters({ grain: "week" }, { today }).grain).toBe("week");
    expect(parseDashFilters({ grain: "hour" }, { today }).grain).toBe("day");
  });

  it("الرابط يُبنى بلا الافتراضي، والمخصّص بتاريخيه", () => {
    const f = parseDashFilters({ project: UUID }, { today });
    expect(dashQuery(f)).toEqual({ project: UUID });
    const c = parseDashFilters({ from: "2026-09-01", to: "2026-09-10" }, { today });
    expect(dashQuery(c, { grain: "week" })).toEqual({ from: "2026-09-01", to: "2026-09-10", grain: "week" });
  });

  it("رابط النزول يحمل نفس المقياس والمدى والمُرشِّحات، و«الآن» إن بلغ المدى اليوم", () => {
    const f = parseDashFilters({ project: UUID }, { today });
    const href = drillHref("REVENUE", f);
    expect(href.startsWith("/dashboard/crm/reports/drill?")).toBe(true);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("metric")).toBe("REVENUE");
    expect(q.get("from")).toBe("2026-10-01");
    expect(q.get("to")).toBe("2026-10-07");
    expect(q.get("project")).toBe(UUID);
    expect(q.get("state")).toBe("current");
    const past = parseDashFilters({ range: "last_month" }, { today });
    expect(new URLSearchParams(drillHref("REVENUE", past).split("?")[1]).get("state")).toBeNull();
  });

  it("المقارنة بالموضع", () => {
    expect(alignByIndex([1, 2, 3], [9, 8])).toEqual([9, 8, null]);
  });
});

describe("نموذج المؤشّر: اللون من معنى المؤشّر لا من إشارته", () => {
  it("ارتفاع المبيعات جيد", () => {
    const k = makeKpi({ key: "s", title: "", value: 120, unit: "money", direction: "positive", icon: "" }, 100);
    expect(k.delta?.tone).toBe("good");
    expect(k.delta?.pct).toBe(20);
  });
  it("ارتفاع دورة البيع سيئ", () => {
    const k = makeKpi({ key: "c", title: "", value: 40, unit: "days", direction: "negative", icon: "" }, 30);
    expect(k.delta?.tone).toBe("bad");
  });
  it("المحايد بلا حكم", () => {
    const k = makeKpi({ key: "n", title: "", value: 5, unit: "count", direction: "neutral", icon: "" }, 10);
    expect(k.delta?.tone).toBe("neutral");
  });
  it("من صفر: لا نسبة (جديد)، وبلا فترة سابقة: لا مقارنة", () => {
    expect(makeKpi({ key: "z", title: "", value: 5, unit: "count", direction: "positive", icon: "" }, 0).delta?.pct).toBeNull();
    expect(makeKpi({ key: "u", title: "", value: 5, unit: "count", direction: "positive", icon: "" }, undefined).delta).toBeNull();
  });
  it("حالة العدّاد التنبيهي", () => {
    expect(countStatus(0)).toBe("good");
    expect(countStatus(3)).toBe("danger");
    expect(countStatus(null)).toBe("neutral");
  });
});

describe("ترتيب المشاريع", () => {
  it("التصريف نسبةٌ من الإجمالي، وبلا وحدات لا نسبة", () => {
    expect(sellThrough(116, 306)).toBe(37.9);
    expect(sellThrough(0, 0)).toBeNull();
  });
  it("الأعلى تصريفاً الأفضل، والأدنى ذو المخزون يحتاج انتباهاً", () => {
    const r = rankProjects([
      { id: "a", sellThrough: 37.9, revenue: 10, available: 184 },
      { id: "b", sellThrough: 1.3, revenue: 0, available: 395 },
    ]);
    expect(Array.from(r.top)).toEqual(["a"]);
    expect(Array.from(r.attention)).toEqual(["b"]);
  });
  it("مشروع واحد لا يُصنَّف", () => {
    const r = rankProjects([{ id: "a", sellThrough: 50, revenue: 1, available: 1 }]);
    expect(r.top.size + r.attention.size).toBe(0);
  });
});

// ===== لوحة لكل شخص (184) =====
import { fallbackViews, pickView, toViewsInfo, viewHref } from "./views";

describe("لوحة لكل شخص", () => {
  it("قبل 184 أو عند الفشل: اللوحة من الدور كما كانت", () => {
    expect(toViewsInfo(null, "admin")).toMatchObject({ views: ["executive"], source: "fallback" });
    expect(fallbackViews("employee")).toEqual(["sales"]);
    expect(fallbackViews("accountant")).toEqual(["finance"]);
  });

  it("القيم الغريبة من القاعدة تُهمل، والأساسية يجب أن تكون من لوحاته", () => {
    const info = toViewsInfo({ views: ["marketing", "hack", "sales"], primary: "executive", source: "override", mismatch: true }, "employee");
    expect(info.views).toEqual(["marketing", "sales"]);
    expect(info.primary).toBe("marketing");
    expect(info.source).toBe("override");
    expect(info.mismatch).toBe(true);
  });

  it("الرابط لا يفتح لوحة ليست له", () => {
    const info = toViewsInfo({ views: ["sales", "rm"], primary: "sales" }, "employee");
    expect(pickView(info, "rm")).toBe("rm");
    expect(pickView(info, "executive")).toBe("sales");
    expect(pickView(info, undefined)).toBe("sales");
  });

  it("المالية وHR بوابتان: لا تُعرضان هنا، ومن ليس له غيرهما ← null (يُحوَّل)", () => {
    const admin = toViewsInfo({ views: ["executive", "finance", "hr"], primary: "executive" }, "admin");
    expect(pickView(admin, "finance")).toBe("executive");
    expect(viewHref("finance")).toBe("/dashboard/finance");
    const acc = toViewsInfo({ views: ["finance"], primary: "finance" }, "accountant");
    expect(pickView(acc, undefined)).toBeNull();
  });

  it("رابط اللسان يُبقي الفترة والمشروع فقط", () => {
    const href = viewHref("team", { range: "last_month", project: "p1", grain: "week" } as Record<string, string>);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("view")).toBe("team");
    expect(q.get("range")).toBe("last_month");
    expect(q.get("project")).toBe("p1");
    expect(q.get("grain")).toBeNull();
  });
});
