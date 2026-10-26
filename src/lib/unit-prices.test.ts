import { describe, it, expect } from "vitest";
import {
  buildIndex,
  buildPricePreview,
  newPrice,
  normKey,
  parseNum,
  priceUpdates,
  unitKeys,
  type PriceUnit,
  type SheetCells,
} from "./unit-prices";

// وحدات على شكل لاماك: «A / 7.FLOOR» + رقم الشقة، والباركود A.7.FLOOR.1
function unit(id: string, tower: string, floor: number, no: number, area: number, extra: Partial<PriceUnit> = {}): PriceUnit {
  const label = `${tower}.${floor}.FLOOR.${no}`;
  return {
    id,
    unit_code: String(no),
    node_path: `${tower} / ${floor}.FLOOR`,
    space_m2: area,
    price: null,
    status: "متاحة",
    attrs: { barcode: label, label },
    ...extra,
  };
}

const units: PriceUnit[] = [
  unit("a101", "A", 1, 1, 125.57),
  unit("a111", "A", 1, 11, 90),
  unit("a1101", "A", 11, 1, 125.57),
  unit("d101", "D", 1, 1, 110.97, { price: 1, status: "مباعة" }),
];

const header = ["", "Code", "الكود الموحد", "الطابق", "المساحة (م²)", "سعر المتر", "السعر الإجمالي", "(16%)Ad.p"];
const title = Array(8).fill("جدول تسعير برج A - المساحات");

function sheet(name: string, rows: string[][]): SheetCells {
  return { name, rows: [title, header, ...rows] };
}

describe("normKey / parseNum", () => {
  it("يطبّع الحروف والأرقام العربية", () => {
    expect(normKey(" a / 7.floor ")).toBe("A7FLOOR");
    expect(normKey("٧٠١")).toBe("701");
  });
  it("يقرأ الأرقام بفواصلها ووحداتها", () => {
    expect(parseNum("2,250,000")).toBe(2250000);
    expect(parseNum("١٢٥٫٥٧م²")).toBe(125.57);
    expect(parseNum("")).toBeNull();
    expect(parseNum("قيد العمل")).toBeNull();
  });
});

describe("مفاتيح الوحدة", () => {
  it("المختصر برمز البرج والطابق والرقم بخانتين", () => {
    expect(unitKeys(units[0])).toContain("A101");
    expect(unitKeys(units[2])).toContain("A1101");
    expect(unitKeys(units[1])).toContain("A111");
  });
  it("الطابق ١ وحدة ١١ لا يصطدم بالطابق ١١ وحدة ١", () => {
    const idx = buildIndex(units);
    expect(idx.get("A111")).toBe("a111");
    expect(idx.get("A1101")).toBe("a1101");
  });
  it("الرقم المكرّر بين الأبراج ملتبس فلا يُطابَق", () => {
    expect(buildIndex(units).get("1")).toBeNull();
  });
});

describe("المعاينة", () => {
  const sheets = [
    sheet("برج A", [
      ["", "A101", "A-F1-01", "الطابق 1", "125.57", "2250000", "282532500", "45205200"],
      ["", "A1101", "A-F11-01", "الطابق 11", "125.57", "2450000", "307646500", "1"],
      ["", "A999", "", "", "100", "2000000", "200000000", ""],
      ["", "", "", "", "", "", "", ""],
    ]),
    { name: "برج B", rows: [["قيد العمل"], ["قيد العمل"]] },
    sheet("برج D", [
      // إجمالي الملف لا يساوي المساحة × المتر (كما في جدول D)
      ["", "D101", "D-F1-01", "الطابق 1", "110.97", "2250000", "249907500", ""],
      ["", "A101", "", "", "125.57", "2250000", "282532500", ""],
    ]),
  ];
  const p = buildPricePreview(sheets, units);

  it("يتخطّى العنوان المدموج ويكشف الأعمدة", () => {
    const a = p.sheets[0];
    expect(a.used).toBe(true);
    expect(a.headerRow).toBe(2);
    expect(a.codeHeader).toBe("Code");
    expect(a.totalHeader).toBe("السعر الإجمالي");
    expect(a.ppmHeader).toBe("سعر المتر");
    expect(a.areaHeader).toBe("المساحة (م²)");
    expect(p.sheets[1].used).toBe(false);
  });

  it("يطابق الوحدات ويعلّم الغائب والمكرّر", () => {
    const by = (code: string, sheetName?: string) =>
      p.rows.filter((r) => r.code === code && (!sheetName || r.sheet === sheetName));
    expect(by("A101", "برج A")[0].unitId).toBe("a101");
    expect(by("A101", "برج A")[0].row).toBe(3);
    expect(by("A999")[0].issue).toBe("not_found");
    expect(by("A101", "برج D")[0].issue).toBe("duplicate");
    expect(p.rows).toHaveLength(5); // الصفّ الفارغ لا يُحسب
    expect(p.missing.map((m) => m.id)).toEqual(["a111"]);
  });

  it("يكشف فرق الإجمالي عن المساحة × المتر ويحسب الخيارين", () => {
    const d = p.rows.find((r) => r.code === "D101")!;
    expect(d.mismatch).toBe(true);
    expect(newPrice(d, "total")).toBe(249907500);
    expect(newPrice(d, "ppm")).toBe(Math.round(110.97 * 2250000));
    const a = p.rows.find((r) => r.code === "A101")!;
    expect(a.mismatch).toBe(false);
  });

  it("التحديثات: المطابَق المتغيّر وحده، بلا الغائب ولا المكرّر", () => {
    const ups = priceUpdates(p.rows, "total");
    expect(ups.map((u) => u.id).sort()).toEqual(["a101", "a1101", "d101"]);
    const same = buildPricePreview(sheets, units.map((u) => (u.id === "a101" ? { ...u, price: 282532500 } : u)));
    expect(priceUpdates(same.rows, "total").map((u) => u.id)).not.toContain("a101");
  });

  it("سعر المتر وحده يكفي: المساحة من النظام", () => {
    const only = buildPricePreview(
      [{ name: "s", rows: [["الكود", "سعر المتر", "ملاحظة"], ["A101", "2,000,000", "-"]] }],
      units
    );
    expect(newPrice(only.rows[0], "total")).toBe(Math.round(125.57 * 2000000));
  });
});
