import { describe, it, expect } from "vitest";
import {
  buildMatrix, canSum, compareValues, fillBuckets, fmtDelta, funnelSteps, insightsFromTrend,
  pipelineMovement, sortRows, valueOf, concentrationInsight, changeInsight,
  type EngineRow, type MetricDef,
} from "./report-engine";

const m = (code: string, agg = "count", unit: MetricDef["unit"] = "count", good: MetricDef["good_direction"] = "up") =>
  ({ code, agg, unit, good_direction: good, name_ar: code }) as MetricDef;

const CALLS = m("CALLS");
const UNIQUE = m("UNIQUE_CLIENTS_CONTACTED", "clients");
const CONV = m("CONVERSION_RATE", "ratio", "pct");
const CYCLE = m("AVG_SALES_CYCLE", "avg:cycle_days", "days", "down");
const OVERDUE = m("OVERDUE", "count", "count", "down");

describe("المقارنة (§23): الحالي والسابق والفرق والنسبة", () => {
  it("مثال الطلب: ٤٢٠ مقابل ٣٥٠ = +٧٠ (+٢٠٪)", () => {
    const d = compareValues(420, 350, "up");
    expect(d).toMatchObject({ change: 70, pct: 20, tone: "good" });
    expect(fmtDelta(d, "count")).toBe("+70 (+20٪)");
  });
  it("المتأخّر يزيد = سيئ", () => expect(compareValues(60, 50, "down").tone).toBe("bad"));
  it("من صفر: لا نسبة — «جديد» لا «∞٪»", () => {
    const d = compareValues(5, 0, "up");
    expect(d.pct).toBeNull();
    expect(fmtDelta(d, "count")).toBe("+5 (جديد)");
  });
  it("النسبة المئوية تُقارن بالنقاط لا بنسبة النسبة", () =>
    expect(fmtDelta(compareValues(2.1, 1.8, "up"), "pct")).toBe("+0.3 نقطة"));
  it("غياب أحد الطرفين = لا حكم", () => expect(compareValues(null, 3, "up").tone).toBe("neutral"));
});

describe("القيمة الغائبة", () => {
  const row: EngineRow = { dims: {}, metrics: {} };
  it("العدّ الغائب صفر — لا حدث = صفر", () => expect(valueOf(row, CALLS)).toBe(0));
  it("المتوسط الغائب «غير متاح» — لا متوسط لصفر صفقات", () => expect(valueOf(row, CYCLE)).toBeNull());
  it("النسبة الغائبة «غير متاح»", () => expect(valueOf(row, CONV)).toBeNull());
});

describe("§13 و§84: لا جمع للفريد", () => {
  it("العدّ والمجموع يُجمعان", () => {
    expect(canSum(CALLS)).toBe(true);
    expect(canSum({ agg: "sum:value" })).toBe(true);
  });
  it("العملاء الفريدون والمتوسط والنسبة لا تُجمع — المجموع يُطلب من المحرّك", () => {
    expect(canSum(UNIQUE)).toBe(false);
    expect(canSum(CYCLE)).toBe(false);
    expect(canSum(CONV)).toBe(false);
  });
});

describe("الأيام الصامتة تُملأ بأصفار (§25)", () => {
  it("الجمعة بلا تواصل صفٌّ بصفر لا فجوة", () => {
    const rows: EngineRow[] = [
      { dims: { day: "2026-09-24" }, metrics: { CALLS: 72 } },
      { dims: { day: "2026-09-26" }, metrics: { CALLS: 101 } },
    ];
    const filled = fillBuckets(rows, "day", ["2026-09-24", "2026-09-25", "2026-09-26"]);
    expect(filled.map((r) => valueOf(r, CALLS))).toEqual([72, 0, 101]);
  });
});

describe("الترتيب", () => {
  it("تنازلي بالمقياس", () => {
    const rows: EngineRow[] = [
      { dims: { employee: "a" }, metrics: { CALLS: 3 } },
      { dims: { employee: "b" }, metrics: { CALLS: 9 } },
    ];
    expect(sortRows(rows, "-CALLS", [CALLS]).map((r) => r.dims.employee)).toEqual(["b", "a"]);
  });
});

describe("المصفوفة الموظف × اليوم (§26)", () => {
  it("الخلايا والمجاميع من المحرّك، والأعمدة كل الأيام بترتيبها", () => {
    const mx = buildMatrix(
      [
        { dims: { employee: "a", day: "d1" }, metrics: { CALLS: 20 } },
        { dims: { employee: "b", day: "d2" }, metrics: { CALLS: 30 } },
      ],
      "employee", "day", CALLS,
      {
        colKeys: ["d1", "d2", "d3"],
        rowTotals: [{ dims: { employee: "a" }, metrics: { CALLS: 20 } }, { dims: { employee: "b" }, metrics: { CALLS: 30 } }],
        grand: { dims: {}, metrics: { CALLS: 50 } },
      }
    );
    expect(mx.colKeys).toEqual(["d1", "d2", "d3"]);
    expect(mx.rowKeys).toEqual(["b", "a"]);
    expect(mx.cells.get("a¦d1")).toBe(20);
    expect(mx.cells.get("a¦d3")).toBeUndefined();
    expect(mx.grand).toBe(50);
    expect(mx.max).toBe(30);
  });
});

describe("القمع (§28): العدد والتحويل والتسرّب", () => {
  it("مثال الطلب: ٣٢٥ ← ٢٨٠ ← ١٢٠", () => {
    const s = funnelSteps([{ code: "NEW", value: 325 }, { code: "CONTACTED", value: 280 }, { code: "QUALIFIED", value: 120 }]);
    expect(s[0]).toMatchObject({ pctOfFirst: 100, stepConversion: null });
    expect(s[1]).toMatchObject({ pctOfFirst: 86.2, stepConversion: 86.2, dropOff: 13.8 });
    expect(s[2]).toMatchObject({ pctOfFirst: 36.9, stepConversion: 42.9, dropOff: 57.1 });
  });
});

describe("حركة الأنابيب (§30)", () => {
  it("الصافي والتوازن — والفرق غير المفسَّر يُعرض لا يُخفى", () => {
    const mv = pipelineMovement({
      opening: { count: 100, value: 1000 }, closing: { count: 110, value: 1300 },
      events: { newOpps: 30, progressions: 12, regressions: 2, reopened: 1, won: 5, lost: 15 },
    });
    expect(mv.netCount).toBe(10);
    expect(mv.netValue).toBe(300);
    expect(mv.unexplained).toBe(-1); // ١١٠ − (١٠٠ + ٣٠ + ١ − ٥ − ١٥)
  });
  it("بلا لقطة افتتاح: لا صافي ولا توازن — لا يُخترع", () => {
    const mv = pipelineMovement({ opening: null, closing: { count: 5, value: 0 }, events: { newOpps: 0, progressions: 0, regressions: 0, reopened: 0, won: 0, lost: 0 } });
    expect(mv.netCount).toBeNull();
    expect(mv.unexplained).toBeNull();
  });
});

describe("الملاحظات وقائع لا أحكام (§64)", () => {
  it("انخفاض عن متوسط الأيام السابقة بنسبته", () => {
    const series = [100, 100, 100, 100, 100, 100, 100, 82].map((v, i) => ({ key: `d${i}`, value: v }));
    const ins = insightsFromTrend(series, "التواصل");
    expect(ins[0].kind).toBe("drop");
    expect(ins[0].text).toContain("18٪");
  });
  it("لا ملاحظة على قاعدة صغيرة", () =>
    expect(insightsFromTrend([1, 2, 1, 0].map((v, i) => ({ key: `d${i}`, value: v })), "x")).toEqual([]));
  it("التركّز: مشروع صنع ٤٢٪ من الليدات", () => {
    const i = concentrationInsight([{ name: "X", value: 42 }, { name: "Y", value: 58 }].reverse(), 100, "الليدات الجديدة", "المشروع", 40);
    expect(i?.text).toContain("58٪");
  });
  it("تغيّر التحويل بالنقاط", () =>
    expect(changeInsight("التحويل", compareValues(12, 5, "up"), "pct")?.text).toContain("+7 نقطة"));
  it("لا اسم موظف في النص", () => {
    const series = [10, 10, 10, 10, 10, 10, 10, 1].map((v, i) => ({ key: `d${i}`, value: v }));
    for (const x of insightsFromTrend(series, "التواصل")) expect(x.text).not.toMatch(/كسول|ضعيف|مقصّر/);
  });
});
