import type { Task } from "@/lib/types";
import { isOpenTask } from "@/lib/types";
import { baghdadDate } from "@/lib/time";

// ============================================================
// ترتيب وتصنيف المهام — دوال خالصة (بلا قاعدة بيانات) حتى تُستعمل
// في صفحات الخادم وفي مكوّنات المتصفح معاً، وحتى يسهل اختبارها.
//
// كل التواريخ هنا نصوص YYYY-MM-DD **بتوقيت بغداد** (تُمرَّر من
// baghdadDate() في src/lib/time.ts — لا تستخدم توقيت الجهاز).
// ============================================================

const PRIORITY_RANK: Record<string, number> = {
  "عاجلة": 0,
  "متوسطة": 1,
  "عادية": 2,
};

// الأهم أولاً: الأولوية، ثم الوقت المحدَّد، ثم الأقدم إنشاءً
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    if (p !== 0) return p;
    const at = a.due_time ?? "99:99";
    const bt = b.due_time ?? "99:99";
    if (at !== bt) return at < bt ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
}

export type TaskBuckets = {
  late: Task[];      // فات موعدها ولم تُنجز
  today: Task[];     // موعدها اليوم
  upcoming: Task[];  // قادمة
  done: Task[];      // منجزة أو ملغاة
};

export function groupTasks(tasks: Task[], todayISO: string): TaskBuckets {
  const buckets: TaskBuckets = { late: [], today: [], upcoming: [], done: [] };

  tasks.forEach((t) => {
    if (!isOpenTask(t.status)) {
      buckets.done.push(t);
    } else if (t.due_date < todayISO) {
      buckets.late.push(t);
    } else if (t.due_date === todayISO) {
      buckets.today.push(t);
    } else {
      buckets.upcoming.push(t);
    }
  });

  buckets.late = sortTasks(buckets.late);
  buckets.today = sortTasks(buckets.today);
  buckets.upcoming = sortTasks(buckets.upcoming);
  // المنجزة: الأحدث إنجازاً أولاً
  buckets.done.sort((a, b) =>
    (b.completed_at ?? b.updated_at) > (a.completed_at ?? a.updated_at) ? 1 : -1
  );

  return buckets;
}

// متابعات اليوم: مهام مفتوحة موعد متابعتها اليوم أو فات
export function followUpsDue(tasks: Task[], todayISO: string): Task[] {
  return sortTasks(
    tasks.filter(
      (t) => isOpenTask(t.status) && t.follow_up_date != null && t.follow_up_date <= todayISO
    )
  );
}

// أرقام مختصرة لعرضها في البطاقات
export function taskCounts(tasks: Task[], todayISO: string) {
  const g = groupTasks(tasks, todayISO);
  // «أُنجزت اليوم» تُقاس بتوقيت بغداد لا بتوقيت الخادم
  const doneToday = tasks.filter(
    (t) => t.status === "منجزة" && t.completed_at && baghdadDate(t.completed_at) === todayISO
  ).length;

  return {
    late: g.late.length,
    today: g.today.length,
    upcoming: g.upcoming.length,
    open: g.late.length + g.today.length + g.upcoming.length,
    doneToday,
    followUps: followUpsDue(tasks, todayISO).length,
  };
}
