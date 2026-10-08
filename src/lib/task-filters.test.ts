import { describe, expect, it } from "vitest";
import {
  countActiveFilters, parsePage, parseTaskFilters, parseView, taskFiltersToParams, toTaskListPayload, withParams,
} from "./task-filters";

const U = "11111111-2222-4333-8444-555555555555";

describe("parseTaskFilters", () => {
  it("يقرأ القيم الصالحة ويُسقط الفارغ", () => {
    const f = parseTaskFilters({ q: "  عرض سعر ", status: "جديدة,قيد التنفيذ", dept: U, assignee: "me", sort: "due", top: "1" });
    expect(f).toEqual({ q: "عرض سعر", status: ["جديدة", "قيد التنفيذ"], dept: U, assignee: "me", sort: "due", top: true });
  });

  it("يرفض القيم المزوّرة: حالة إنجليزية، معرّف غير صالح، ترتيب مجهول", () => {
    const f = parseTaskFilters({ status: "done,منجزة", dept: "1; drop table", sort: "evil", bucket: "x", assignee: "anyone" });
    expect(f).toEqual({ status: ["منجزة"] });
  });

  it("رابط الجودة filter=orphan يفعّل مرشّح العميل المغلق", () => {
    expect(parseTaskFilters({ filter: "orphan" }).orphan).toBe(true);
  });

  it("يقبل مصفوفة المعاملات من Next ويأخذ الأولى", () => {
    expect(parseTaskFilters({ q: ["أ", "ب"] }).q).toBe("أ");
  });

  it("التاريخ بصيغة YYYY-MM-DD فقط", () => {
    expect(parseTaskFilters({ from: "2026-10-01", to: "10/10/2026" })).toEqual({ from: "2026-10-01" });
  });
});

describe("toTaskListPayload", () => {
  it("يحوّل أسماء العنوان إلى معاملات task_list", () => {
    const p = toTaskListPayload({ type: ["call"], source: ["crm"], dept: U, assignee: "me", from: "2026-10-01", top: true, orphan: true });
    expect(p).toEqual({ task_type: ["call"], task_source: ["crm"], department_id: U, assigned_to: "me", due_from: "2026-10-01", parent: "top", orphan: true });
  });

  it("الإضافات تغلب", () => {
    expect(toTaskListPayload({ bucket: "late" }, { bucket: "open" })).toEqual({ bucket: "open" });
  });
});

describe("taskFiltersToParams ↔ parseTaskFilters", () => {
  it("ذهاب وإياب بلا فقد", () => {
    const f = parseTaskFilters({ q: "x", status: "منجزة", priority: "عاجلة", label: U, archived: "include", orphan: "1" });
    expect(parseTaskFilters(taskFiltersToParams(f))).toEqual(f);
  });

  it("الترتيب لا يُعدّ مرشّحاً نشطاً", () => {
    expect(countActiveFilters({ sort: "due" })).toBe(0);
    expect(countActiveFilters({ sort: "due", q: "x", dept: U })).toBe(2);
  });
});

describe("parseView / parsePage / withParams", () => {
  it("عرض مجهول يعود للافتراضي", () => {
    expect(parseView("hack")).toBe("mine");
    expect(parseView("board")).toBe("board");
    expect(parseView(undefined, "list")).toBe("list");
  });
  it("الصفحة رقم موجب", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("-1")).toBe(1);
    expect(parsePage("abc")).toBe(1);
  });
  it("withParams يضيف ويحذف", () => {
    expect(withParams("/t", { a: "1", b: "2" }, { b: null, c: "3" })).toBe("/t?a=1&c=3");
    expect(withParams("/t", {}, {})).toBe("/t");
  });
});
