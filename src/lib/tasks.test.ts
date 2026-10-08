import { describe, expect, it } from "vitest";
import type { Task, TaskActivity } from "./types";
import {
  activitySentence, addDays, boardBySteps, boardByStatus, formatMinutes, friendlyTaskError, groupTasks,
  monthGrid, monthRange, progressOf, shiftMonth, sortTasks, taskCounts, weekDays, weekStart,
} from "./tasks";

const base: Task = {
  id: "t", created_at: "2026-10-01T08:00:00Z", created_by: "u", created_by_name: "أحمد", created_by_role: "موظف",
  assigned_to: "u", assigned_to_name: "أحمد", title: "مهمة", description: null, priority: "عادية", status: "جديدة",
  due_date: "2026-10-08", due_time: null, next_step: null, follow_up_date: null, client_id: null,
  completed_at: null, updated_at: "2026-10-01T08:00:00Z",
};
const mk = (p: Partial<Task>): Task => ({ ...base, ...p });
const TODAY = "2026-10-08";

describe("groupTasks", () => {
  it("يقسّم: متأخرة، اليوم، قادمة، بدون موعد، مغلقة", () => {
    const g = groupTasks([
      mk({ id: "late", due_date: "2026-10-07" }),
      mk({ id: "today" }),
      mk({ id: "up", due_date: "2026-10-09" }),
      mk({ id: "nodate", due_date: null }),
      mk({ id: "done", status: "منجزة", completed_at: "2026-10-08T05:00:00Z" }),
      mk({ id: "cancel", status: "ملغاة" }),
    ], TODAY);
    expect(g.late.map((t) => t.id)).toEqual(["late"]);
    expect(g.today.map((t) => t.id)).toEqual(["today"]);
    expect(g.upcoming.map((t) => t.id)).toEqual(["up"]);
    expect(g.nodate.map((t) => t.id)).toEqual(["nodate"]);
    expect(g.done.map((t) => t.id).sort()).toEqual(["cancel", "done"]);
  });

  it("المهمة بلا موعد ليست متأخرة أبداً", () => {
    expect(taskCounts([mk({ due_date: null })], TODAY)).toMatchObject({ late: 0, nodate: 1, open: 1 });
  });
});

describe("sortTasks", () => {
  it("الأولوية أولاً، ثم الأقرب موعداً، ثم الوقت، وبلا موعد آخراً", () => {
    const s = sortTasks([
      mk({ id: "a", priority: "عادية", due_date: "2026-10-01" }),
      mk({ id: "b", priority: "عاجلة", due_date: null }),
      mk({ id: "c", priority: "عاجلة", due_date: "2026-10-09" }),
      mk({ id: "d", priority: "عاجلة", due_date: "2026-10-09", due_time: "09:00:00" }),
    ]);
    expect(s.map((t) => t.id)).toEqual(["d", "c", "b", "a"]);
  });
});

describe("اللوحة", () => {
  it("بالحالة: الملغاة مخفية افتراضياً", () => {
    const cols = boardByStatus([{ status: "جديدة" }, { status: "ملغاة" }, { status: "منجزة" }]);
    expect(cols.map((c) => c.key)).toEqual(["جديدة", "قيد التنفيذ", "منجزة"]);
    expect(cols[0].items).toHaveLength(1);
  });
  it("بالخطوات: ما بلا خطوة في عمود «بلا خطوة» أولاً", () => {
    const steps = [{ id: "s2", name_ar: "مراجعة", position: 2, color: "purple" }, { id: "s1", name_ar: "فكرة", position: 1, color: "gray" }];
    const cols = boardBySteps([{ workflow_step_id: "s1" }, { workflow_step_id: null }, { workflow_step_id: "zz" }], steps);
    expect(cols.map((c) => c.key)).toEqual(["none", "s1", "s2"]);
    expect(cols[0].items).toHaveLength(2);
  });
});

describe("التقويم", () => {
  it("الأسبوع يبدأ بالسبت", () => {
    expect(weekStart("2026-10-08")).toBe("2026-10-03"); // الخميس ← السبت قبله
    expect(weekStart("2026-10-03")).toBe("2026-10-03");
    expect(weekDays("2026-10-08")).toHaveLength(7);
  });
  it("شبكة الشهر ٥ أو ٦ أسابيع تغطي كل أيامه", () => {
    const g = monthGrid("2026-10-15");
    expect(g.days.length % 7).toBe(0);
    expect(g.days.filter((d) => d.inMonth)).toHaveLength(31);
    expect(g.days[0].iso <= "2026-10-01").toBe(true);
  });
  it("حدود الشهر وتنقّله عبر السنة", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("العرض", () => {
  it("formatMinutes", () => {
    expect(formatMinutes(null)).toBeNull();
    expect(formatMinutes(45)).toBe("45 د");
    expect(formatMinutes(120)).toBe("2 س");
    expect(formatMinutes(135)).toBe("2 س 15 د");
  });
  it("progressOf يجمع الفرعية وقائمة التحقق", () => {
    expect(progressOf({ subtasks_total: 2, subtasks_done: 1, checklist_total: 3, checklist_done: 3 })).toEqual({ total: 5, done: 4, pct: 80 });
    expect(progressOf({ subtasks_total: 0, subtasks_done: 0, checklist_total: 0, checklist_done: 0 }).pct).toBeNull();
  });
  it("سطر السجلّ بالعربية", () => {
    const a = (p: Partial<TaskActivity>): TaskActivity => ({ id: 1, action: "created", field: null, old_value: null, new_value: null, note: null, actor_name: "عبدالله", at: "", ...p });
    expect(activitySentence(a({}))).toBe("عبدالله أنشأ المهمة");
    expect(activitySentence(a({ action: "reassigned", old_value: "أحمد", new_value: "سارة" }))).toBe("عبدالله نقل المهمة من أحمد إلى سارة");
    expect(activitySentence(a({ action: "due_date_changed", new_value: "2026-10-12" }))).toBe("عبدالله غيّر الموعد إلى 2026-10-12");
    expect(activitySentence(a({ action: "edited", field: "next_step", new_value: "اتصل" }))).toBe("عبدالله عدّل الخطوة القادمة: اتصل");
    expect(activitySentence(a({ actor_name: null, action: "completed" }))).toBe("النظام أنجز المهمة");
  });
  it("رسائل الخطأ: العربية كما هي، والتقنية تُخفى", () => {
    expect(friendlyTaskError({ message: "لا تملك صلاحية إسناد هذه المهمة لهذا الموظف." })).toContain("لا تملك");
    expect(friendlyTaskError({ message: "new row violates row-level security policy" })).toBe("لا تملك صلاحية هذا الإجراء.");
    expect(friendlyTaskError({ message: "x", hint: "version_conflict" })).toContain("حدّث الصفحة");
    expect(friendlyTaskError({ message: "boom" })).toBe("تعذّر الحفظ — حاول مرة أخرى.");
  });
});
