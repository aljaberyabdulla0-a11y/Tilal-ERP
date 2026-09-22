import { describe, it, expect } from "vitest";
import { phoneKey, normalizePhone, normalizeDate, validateRow } from "./clients-excel";

// ============================================================
// phoneKey تطابق public.normalize_iraqi_phone (sql/071) حرفياً —
// القاعدة تكشف التكرار بالمفتاح، والاستيراد يكشفه قبل الحفظ بالمفتاح
// نفسه. اختلافهما يعني تكراراً يمرّ من الاستيراد ثم يُرصد لاحقاً.
// ============================================================
describe("phoneKey — مرآة normalize_iraqi_phone", () => {
  it("يوحّد الكتابات الثلاث لرقم عراقي واحد", () => {
    expect(phoneKey("07701234567")).toBe("9647701234567");
    expect(phoneKey("+9647701234567")).toBe("9647701234567");
    expect(phoneKey("009647701234567")).toBe("9647701234567");
    expect(phoneKey("9647701234567")).toBe("9647701234567");
  });

  it("يتجاهل المسافات والشرطات والأقواس", () => {
    expect(phoneKey("0770 123 4567")).toBe("9647701234567");
    expect(phoneKey("(0770)-123-4567")).toBe("9647701234567");
  });

  it("لا يخترع مفتاحاً لما لا يطابق الشكل العراقي", () => {
    expect(phoneKey("+971509132112")).toBeNull();   // إماراتي
    expect(phoneKey("+19292391199")).toBeNull();    // أمريكي
    expect(phoneKey("0770123456")).toBeNull();      // ناقص رقماً
    expect(phoneKey("077012345678")).toBeNull();    // زائد رقماً
    expect(phoneKey("")).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey(undefined)).toBeNull();
  });

  it("الرقم المحلي الذي ابتلع اكسل صفره يُفهم بعد normalizePhone", () => {
    expect(phoneKey(normalizePhone("7701234567"))).toBe("9647701234567");
  });
});

describe("normalizePhone — إصلاح ما يفسده اكسل", () => {
  it("يعيد الصفر المبتلَع ويحوّل 00 إلى +", () => {
    expect(normalizePhone("7701234567")).toBe("07701234567");
    expect(normalizePhone("009647701234567")).toBe("+9647701234567");
    expect(normalizePhone("9647701234567")).toBe("+9647701234567");
  });
  it("يترك الدولي بمفتاحه", () => {
    expect(normalizePhone("+971 50 913 2112")).toBe("+971509132112");
  });
});

describe("normalizeDate", () => {
  it("يقبل ISO ويوم/شهر/سنة ورقم اكسل التسلسلي", () => {
    expect(normalizeDate("2026-09-22")).toBe("2026-09-22");
    expect(normalizeDate("22/09/2026")).toBe("2026-09-22");
    expect(normalizeDate("1.9.2026")).toBe("2026-09-01");
    expect(normalizeDate("45000")).toBe("2023-03-15");
  });
  it("يرفض ما لا يفهمه بدل أن يخمّن", () => {
    expect(normalizeDate("أمس")).toBeNull();
    expect(normalizeDate("")).toBeNull();
  });
});

// ============================================================
// validateRow — القوائم من القاعدة تحلّ محلّ الثوابت (§71)
// ============================================================
describe("validateRow", () => {
  const base = {
    name: "أحمد علي",
    phone: "7701234567",
    source: "سوشيل ميديا",
    stage: "اتصال",
    sales_employee: "ريتا",
    entry_date: "22/09/2026",
  };

  it("يطبّع الهاتف والتاريخ ويقبل القيم المسموحة", () => {
    const r = validateRow(2, base, ["ريتا"]);
    expect(r.errors).toEqual([]);
    expect(r.values.phone).toBe("07701234567");
    expect(r.values.entry_date).toBe("2026-09-22");
    expect(r.values.stage).toBe("اتصال");
  });

  it("الاسم إلزامي والمرحلة الفارغة تصير «ليد»", () => {
    const r = validateRow(3, { ...base, name: "", stage: "" }, ["ريتا"]);
    expect(r.errors.some((e) => e.includes("الاسم"))).toBe(true);
    expect(r.values.stage).toBe("ليد");
  });

  it("اسم موظف لا يطابق القائمة يُرفض — وإلا لا يرى الموظف عميله أبداً", () => {
    const r = validateRow(4, { ...base, sales_employee: "ريتا ماجد" }, ["ريتا"]);
    expect(r.errors.some((e) => e.includes("موظف المبيعات"))).toBe(true);
    expect(r.values.sales_employee).toBeNull();
  });

  it("القوائم الممرَّرة من القاعدة تحكم لا الثوابت", () => {
    // مصدر جديد أضافه المدير في crm_sources ولم يكن في CLIENT_SOURCES
    const withDb = validateRow(5, { ...base, source: "معرض عقاري" }, ["ريتا"], {
      source: ["سوشيل ميديا", "معرض عقاري"],
    });
    expect(withDb.errors).toEqual([]);
    expect(withDb.values.source).toBe("معرض عقاري");

    const withoutDb = validateRow(5, { ...base, source: "معرض عقاري" }, ["ريتا"]);
    expect(withoutDb.errors.some((e) => e.includes("مصدر العميل"))).toBe(true);
  });

  it("مرحلة معطَّلة في crm_stages لا تُقبل في الاستيراد", () => {
    const r = validateRow(6, base, ["ريتا"], { stage: ["ليد", "زيارة"] });
    expect(r.errors.some((e) => e.includes("مرحلة المبيعات"))).toBe(true);
  });

  it("هاتف من ينوب عنه يُتحقّق منه كالهاتف الأصلي", () => {
    const r = validateRow(7, { ...base, alt_contact_phone: "123" }, ["ريتا"]);
    expect(r.errors.some((e) => e.includes("هاتف من ينوب عنه"))).toBe(true);
  });
});
