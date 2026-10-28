import { describe, expect, it } from "vitest";
import { decodeCsv, guessMapping, mapRows, parseCsv, stripMetaPrefix, toImportPayload } from "./lead-sheet";

describe("guessMapping", () => {
  it("يتعرّف على عناوين تصدير Meta", () => {
    const m = guessMapping(["id", "created_time", "ad_name", "campaign_name", "form_name", "platform", "full_name", "phone_number", "email"]);
    expect(m).toMatchObject({ external_id: 0, created_time: 1, ad: 2, campaign: 3, form: 4, platform: 5, name: 6, phone: 7, email: 8 });
  });
  it("يتعرّف على العناوين العربية ولا يستعمل العمود مرتين", () => {
    const m = guessMapping(["الاسم", "رقم الهاتف", "الحملة", "ملاحظات"]);
    expect(m).toEqual({ name: 0, phone: 1, campaign: 2, message: 3 });
  });
});

describe("stripMetaPrefix", () => {
  it("يزيل بادئات Meta", () => {
    expect(stripMetaPrefix("p:+9647701234567")).toBe("+9647701234567");
    expect(stripMetaPrefix("l:1234567890123")).toBe("1234567890123");
    expect(stripMetaPrefix("07701234567")).toBe("07701234567");
  });
});

describe("mapRows", () => {
  const mapping = { external_id: 0, name: 1, phone: 2, campaign: 3, platform: 4 };
  const rows = [
    ["l:9000000000001", "علي", "p:+9647701234567", "حملة أ", "ig"],
    ["l:9000000000002", "سارة", "0770 123 4568", "حملة أ", "fb"],
    ["l:9000000000001", "علي", "p:+9647701234567", "حملة أ", "ig"], // نفس الليد
    ["", "بلا رقم", "", "حملة أ", ""],
    ["", "رقم ناقص", "0770", "حملة أ", ""],
    ["", "", "", "", ""],
  ];
  const out = mapRows(rows, mapping);

  it("يتخطّى الصفوف الفارغة ويحفظ رقم الصفّ الأصلي", () => {
    expect(out).toHaveLength(5);
    expect(out[4].rowNumber).toBe(6);
  });
  it("يطبّع الهاتف ويقرأ معرّف Meta والمنصّة", () => {
    expect(out[0].phoneKey).toBe("9647701234567");
    expect(out[0].metaId).toBe("9000000000001");
    expect(out[0].platform).toBe("instagram");
    expect(out[1].phoneKey).toBe("9647701234568");
    expect(out[1].platform).toBe("facebook");
  });
  it("يعلّم المكرّر داخل الملف والرقم الناقص والفارغ", () => {
    expect(out.map((r) => r.issue)).toEqual([null, null, "مكرّر داخل الملف", "بلا رقم", "رقم غير صالح"]);
  });
  it("الحمولة تحمل المعرّف بلا بادئة", () => {
    expect(toImportPayload(out[0]).external_id).toBe("9000000000001");
    expect(toImportPayload(out[3]).phone).toBeNull();
  });
});

describe("CSV", () => {
  it("يقرأ UTF-16LE بفواصل Tab (تصدير Meta)", () => {
    const text = "﻿full_name\tphone_number\nعلي\tp:+9647701234567\n";
    const bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      bytes[i * 2] = text.charCodeAt(i) & 0xff;
      bytes[i * 2 + 1] = text.charCodeAt(i) >> 8;
    }
    const rows = parseCsv(decodeCsv(bytes));
    expect(rows).toEqual([["full_name", "phone_number"], ["علي", "p:+9647701234567"]]);
  });
  it("يحترم الاقتباس والفاصلة داخل الخلية", () => {
    const rows = parseCsv('name,note\r\n"علي, محمد","قال ""نعم"""\r\n');
    expect(rows).toEqual([["name", "note"], ["علي, محمد", 'قال "نعم"']]);
  });
});
