import { describe, it, expect } from "vitest";
import {
  FILTER_KEYS, listParam, parseReportParams, toEngineFilters, toQuery, activeFilterCount,
} from "./report-filters";

const today = "2026-09-27";

describe("مرآة crm_rq_where (097) — مفتاحٌ لا تعرفه القاعدة يُتجاهل هناك بصمت", () => {
  it("المفاتيح هي مفاتيح الدالة حرفياً", () => {
    // من map في crm_rq_where + building/floor
    const sql = [
      "project", "employee", "owner", "team", "source", "campaign", "stage", "stage_type", "unit",
      "lost_reason", "activity_type", "result", "direction", "event_type", "reservation_status",
      "temperature", "score_band", "payment_method", "purpose", "area", "silence_bucket",
      "building", "floor",
    ];
    for (const k of FILTER_KEYS) expect(sql).toContain(k);
  });
});

describe("الاختيار المتعدّد (§18)", () => {
  it("نصّ بفواصل", () => expect(listParam("a,b, c")).toEqual(["a", "b", "c"]));
  it("قيم مكرّرة من نموذج GET", () => expect(listParam(["a", "b", "a"])).toEqual(["a", "b"]));
  it("فراغ", () => expect(listParam(undefined)).toEqual([]));

  it("مشروعان وموظف ونوعا تواصل", () => {
    const p = parseReportParams(
      { project: "p1,p2", employee: "e1", activity_type: ["مكالمة", "واتساب"] },
      { today }
    );
    expect(p.filters).toEqual({ project: ["p1", "p2"], employee: ["e1"], activity_type: ["مكالمة", "واتساب"] });
    expect(toEngineFilters(p)).toEqual({ project: ["p1", "p2"], employee: ["e1"], activity_type: ["مكالمة", "واتساب"] });
    expect(activeFilterCount(p)).toBe(3);
  });

  it("owner من المُرشِّحات الموحّدة يُقرأ موظفاً", () =>
    expect(parseReportParams({ owner: "e9" }, { today }).filters.employee).toEqual(["e9"]));

  it("مفتاح مجهول يُهمَل", () =>
    expect(parseReportParams({ salary: "1" } as never, { today }).filters).toEqual({}));
});

describe("المدى من الرابط", () => {
  it("الافتراض آخر ٧ أيام بمقارنة بالفترة السابقة", () => {
    const p = parseReportParams({}, { today });
    expect(p.range).toMatchObject({ from: "2026-09-21", to: today });
    expect(p.compareRange).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  });
  it("تاريخان صريحان يغلبان الاختصار", () => {
    const p = parseReportParams({ range: "last_30", from: "2026-09-01", to: "2026-09-15" }, { today });
    expect(p.preset).toBe("custom");
    expect(p.compareRange).toEqual({ from: "2026-08-17", to: "2026-08-31" });
  });
  it("days=17", () => expect(parseReportParams({ days: "17" }, { today }).range.days).toBe(17));
  it("افتراضات القالب", () => {
    const p = parseReportParams({}, { today, defaults: { preset: "yesterday", basis: "lead_created" } });
    expect(p.range).toMatchObject({ from: "2026-09-26", to: "2026-09-26" });
    expect(p.basis).toBe("lead_created");
  });
  it("قيمة مقارنة غير معروفة ← الافتراض", () =>
    expect(parseReportParams({ compare: "drop table" }, { today }).compare).toBe("previous_period"));
});

describe("الرابط ذهاباً وإياباً — العرض المحفوظ يعيد نفس التقرير (§19)", () => {
  it("toQuery ثم parse = نفس المعاملات", () => {
    const p = parseReportParams({ range: "last_month", project: "p1,p2", compare: "previous_year", score_min: "40" }, { today });
    const q = toQuery(p);
    expect(q).toEqual({ range: "last_month", project: "p1,p2", compare: "previous_year", score_min: "40" });
    const back = parseReportParams(q, { today });
    expect(back.range).toEqual(p.range);
    expect(back.filters).toEqual(p.filters);
    expect(back.scoreMin).toBe(40);
  });
  it("القيم الافتراضية لا تُكتب في الرابط", () => expect(toQuery(parseReportParams({}, { today }))).toEqual({}));
});
