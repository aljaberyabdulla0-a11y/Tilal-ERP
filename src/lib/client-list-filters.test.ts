import { describe, it, expect } from "vitest";
import {
  addDays,
  applyClientListFilters,
  cleanText,
  parseClientListFilters,
  NO_OWNER,
  type ClientFilterContext,
} from "./client-list-filters";

const ctx: ClientFilterContext = {
  stages: ["ليد", "اتصال", "بيع", "فشل البيع"],
  sources: ["مكتب عقاري", "سوشيل ميديا"],
  owners: [
    { id: "e1", full_name: "دانيه ابراهيم جبوري" },
    { id: "e2", full_name: "ندى ماجد يس" },
  ],
  tags: [{ id: "t1", name: "VIP" }],
  temperatures: ["ساخن", "دافئ", "بارد", "خامل"],
  today: "2026-09-23",
};

// باني استعلام مزيّف يسجّل كل نداء — فيُختبر أيّ عمود وأيّ قيمة
function fakeQuery() {
  const calls: [string, ...unknown[]][] = [];
  const q: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ["eq", "is", "gte", "lte", "lt", "ilike", "or", "in"]) {
    q[m] = (...a: unknown[]) => {
      calls.push([m, ...a]);
      return q;
    };
  }
  return { q, calls };
}

describe("parseClientListFilters", () => {
  it("يقبل القيم المعروفة ويبني الرابط والوصف", () => {
    const p = parseClientListFilters(
      { owner: "e1", stage: "اتصال", followup: "overdue", payment: "أقساط" },
      ctx
    );
    expect(p.filters.owner).toBe("e1");
    expect(p.params).toEqual({ owner: "e1", stage: "اتصال", followup: "overdue", payment: "أقساط" });
    expect(p.chips.map((c) => c.label)).toContain("الموظف: دانيه ابراهيم جبوري");
    expect(p.secondaryActive).toBe(true); // طريقة الدفع في «فلاتر إضافية»
  });

  it("يتجاهل بصمت ما ليس في قائمته — رابطٌ قديم لا يُفرغ القائمة", () => {
    const p = parseClientListFilters(
      { owner: "غريب", stage: "مرحلة محذوفة", contact: "forever", tag: "t9", payment: "بيتكوين" },
      ctx
    );
    expect(p.params).toEqual({});
    expect(p.chips).toHaveLength(0);
  });

  it("يقبل «بلا موظف» قيمةً خاصّة", () => {
    const p = parseClientListFilters({ owner: NO_OWNER }, ctx);
    expect(p.filters.owner).toBe(NO_OWNER);
    expect(p.chips[0].label).toBe("بلا موظف");
  });

  it("يقلب المدى المقلوب ويرفض التاريخ غير الصالح", () => {
    expect(parseClientListFilters({ from: "2026-09-10", to: "2026-09-01" }, ctx).filters)
      .toMatchObject({ from: "2026-09-01", to: "2026-09-10" });
    expect(parseClientListFilters({ from: "2026-13-45" }, ctx).filters.from).toBeNull();
    expect(parseClientListFilters({ from: "أمس" }, ctx).filters.from).toBeNull();
  });

  it("المُرشِّحات الأساسية لا تفتح «فلاتر إضافية»", () => {
    expect(parseClientListFilters({ stage: "ليد", contact: "never" }, ctx).secondaryActive).toBe(false);
  });
});

describe("cleanText", () => {
  it("يزيل ما يكسر or() أو يصير نمطاً في ilike", () => {
    expect(cleanText("  علي,(%)*  ")).toBe("علي");
    expect(cleanText("   ")).toBeNull();
  });
});

describe("addDays", () => {
  it("يعبر حدود الشهر", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
  });
});

describe("applyClientListFilters", () => {
  const now = new Date("2026-09-23T10:00:00Z");
  const run = (sp: Parameters<typeof parseClientListFilters>[0], tagClientIds: string[] | null = null) => {
    const { q, calls } = fakeQuery();
    applyClientListFilters(q, parseClientListFilters(sp, ctx).filters, { today: ctx.today, now, tagClientIds });
    return calls;
  };

  it("الموظف بالمفتاح، و«بلا موظف» = owner_id فارغ", () => {
    expect(run({ owner: "e2" })).toEqual([["eq", "owner_id", "e2"]]);
    expect(run({ owner: NO_OWNER })).toEqual([["is", "owner_id", null]]);
  });

  it("تاريخ الإضافة على entry_date لا created_at", () => {
    expect(run({ from: "2026-09-01", to: "2026-09-30" })).toEqual([
      ["gte", "entry_date", "2026-09-01"],
      ["lte", "entry_date", "2026-09-30"],
    ]);
  });

  it("المتابعة بتاريخ بغداد", () => {
    expect(run({ followup: "overdue" })).toEqual([["lt", "follow_up_date", "2026-09-23"]]);
    expect(run({ followup: "today" })).toEqual([["eq", "follow_up_date", "2026-09-23"]]);
    expect(run({ followup: "week" })).toEqual([
      ["gte", "follow_up_date", "2026-09-23"],
      ["lte", "follow_up_date", "2026-09-30"],
    ]);
    expect(run({ followup: "none" })).toEqual([["is", "follow_up_date", null]]);
  });

  it("آخر تواصل: «أبداً» فارغ، و«صامت» قبل الحدّ", () => {
    expect(run({ contact: "never" })).toEqual([["is", "last_contact_at", null]]);
    expect(run({ contact: "over14" })).toEqual([["lt", "last_contact_at", "2026-09-09T10:00:00.000Z"]]);
    expect(run({ contact: "recent" })).toEqual([["gte", "last_contact_at", "2026-09-16T10:00:00.000Z"]]);
  });

  it("الوسم بلا عملاء = لا أحد، لا الكل", () => {
    expect(run({ tag: "t1" }, [])).toEqual([["in", "id", ["00000000-0000-0000-0000-000000000000"]]]);
    expect(run({ tag: "t1" }, ["c1", "c2"])).toEqual([["in", "id", ["c1", "c2"]]]);
  });

  it("المنطقة بحثٌ جزئي، والبحث يشمل جهة الاتصال البديلة", () => {
    expect(run({ area: "المنصور" })).toEqual([["ilike", "area", "%المنصور%"]]);
    const [call] = run({ q: "0771" });
    expect(call[0]).toBe("or");
    expect(String(call[1])).toContain("alt_contact_phone.ilike.%0771%");
  });

  it("بلا مُرشِّح = بلا نداء", () => {
    expect(run({})).toEqual([]);
  });
});
