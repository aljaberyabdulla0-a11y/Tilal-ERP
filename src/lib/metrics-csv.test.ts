import { describe, expect, it } from "vitest";
import { csvToMetricRows, parseCsv } from "./metrics-csv";

describe("parseCsv", () => {
  it("يفهم الاقتباس والفاصلة داخل الخلية و BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","z ""q"""\n')).toEqual([["a", "b"], ["x, y", 'z "q"']]);
  });
  it("يقبل الجدولة والفاصلة المنقوطة (تصدير Excel العربي)", () => {
    expect(parseCsv("a\tb\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("csvToMetricRows", () => {
  it("قالب تلال كما هو", () => {
    const r = csvToMetricRows("date,campaign_code,spend,leads\n2026-09-01,cmp-0001,150000,12", { usdRate: 1310 });
    expect(r.error).toBeNull();
    expect(r.rows).toEqual([{ date: "2026-09-01", campaign_code: "cmp-0001", spend: 150000, leads: 12 }]);
  });
  it("تصدير ميتا: الدولار يُحوَّل بالسعر، والإعلان كيانٌ افتراضي", () => {
    const csv = 'Day,Ad ID,Amount spent (USD),Impressions,Link clicks,Results\n2026-09-02,1203,"10.50","1,234",40,3';
    const r = csvToMetricRows(csv, { usdRate: 1300 });
    expect(r.rows[0]).toMatchObject({ date: "2026-09-02", ad_external_id: "1203", spend: 13650, impressions: 1234, link_clicks: 40, leads: 3, entity_type: "إعلان" });
  });
  it("الأعمدة المجهولة تُعلَن ولا تُسقط الملف", () => {
    const r = csvToMetricRows("date,content_code,Frequency\n2026-09-01,cnt-0001,1.3", { usdRate: 1 });
    expect(r.unknownHeaders).toEqual(["Frequency"]);
    expect(r.rows[0]).toEqual({ date: "2026-09-01", content_code: "cnt-0001" });
  });
  it("بلا تاريخ أو بلا كيان: رسالة لا صفوف", () => {
    expect(csvToMetricRows("spend\n1", { usdRate: 1 }).error).toMatch(/تاريخ/);
    expect(csvToMetricRows("date,spend\n2026-01-01,1", { usdRate: 1 }).error).toMatch(/الكيان/);
  });
});
