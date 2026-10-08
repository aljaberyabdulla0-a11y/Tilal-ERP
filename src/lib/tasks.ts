import type { Task, TaskActivity, TaskLabelColor, TaskRow } from "@/lib/types";
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

// الأهم أولاً: الأولوية، ثم اليوم (بلا موعد آخراً)، ثم الوقت، ثم الأقدم إنشاءً
export function sortTasks<T extends Task>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    if (p !== 0) return p;
    const ad = a.due_date ?? "9999-99-99";
    const bd = b.due_date ?? "9999-99-99";
    if (ad !== bd) return ad < bd ? -1 : 1;
    const at = a.due_time ?? "99:99";
    const bt = b.due_time ?? "99:99";
    if (at !== bt) return at < bt ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });
}

export type TaskBuckets<T extends Task = Task> = {
  late: T[];      // فات موعدها ولم تُنجز
  today: T[];     // موعدها اليوم
  upcoming: T[];  // قادمة
  nodate: T[];    // مفتوحة بلا موعد
  done: T[];      // منجزة أو ملغاة
};

export function groupTasks<T extends Task>(tasks: T[], todayISO: string): TaskBuckets<T> {
  const buckets: TaskBuckets<T> = { late: [], today: [], upcoming: [], nodate: [], done: [] };

  tasks.forEach((t) => {
    if (!isOpenTask(t.status)) {
      buckets.done.push(t);
    } else if (t.due_date == null) {
      buckets.nodate.push(t);
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
  buckets.nodate = sortTasks(buckets.nodate);
  // المنجزة: الأحدث إنجازاً أولاً
  buckets.done.sort((a, b) =>
    (b.completed_at ?? b.updated_at) > (a.completed_at ?? a.updated_at) ? 1 : -1
  );

  return buckets;
}

// متابعات اليوم: مهام مفتوحة موعد متابعتها اليوم أو فات
export function followUpsDue<T extends Task>(tasks: T[], todayISO: string): T[] {
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
    nodate: g.nodate.length,
    open: g.late.length + g.today.length + g.upcoming.length + g.nodate.length,
    doneToday,
    followUps: followUpsDue(tasks, todayISO).length,
  };
}

// ============================================================
// اللوحة (Kanban): أعمدة بالحالة العامة، أو بخطوات المسار
// ============================================================
export const STATUS_COLUMNS = ["جديدة", "قيد التنفيذ", "منجزة", "ملغاة"] as const;

export type BoardColumn<T> = { key: string; title: string; color: string; items: T[] };

export function boardByStatus<T extends Pick<TaskRow, "status">>(rows: T[], includeCancelled = false): BoardColumn<T>[] {
  const colors: Record<string, string> = {
    "جديدة": "blue", "قيد التنفيذ": "amber", "منجزة": "green", "ملغاة": "gray",
  };
  return STATUS_COLUMNS.filter((s) => includeCancelled || s !== "ملغاة").map((s) => ({
    key: s,
    title: s,
    color: colors[s],
    items: rows.filter((r) => r.status === s),
  }));
}

export function boardBySteps<T extends Pick<TaskRow, "workflow_step_id">>(
  rows: T[],
  steps: { id: string; name_ar: string; position: number; color: string }[],
): BoardColumn<T>[] {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const known = new Set(ordered.map((s) => s.id));
  const cols: BoardColumn<T>[] = ordered.map((s) => ({
    key: s.id,
    title: s.name_ar,
    color: s.color,
    items: rows.filter((r) => r.workflow_step_id === s.id),
  }));
  const loose = rows.filter((r) => !r.workflow_step_id || !known.has(r.workflow_step_id));
  if (loose.length) cols.unshift({ key: "none", title: "بلا خطوة", color: "gray", items: loose });
  return cols;
}

// ============================================================
// التقويم: شبكة شهر تبدأ بالسبت (الأسبوع العراقي)، وأسبوع من سبعة أيام
// ============================================================
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 0 = الأحد … 6 = السبت
export function weekdayOf(iso: string): number {
  return new Date(iso + "T00:00:00Z").getUTCDay();
}

// بداية الأسبوع (السبت) لليوم المعطى
export function weekStart(iso: string): string {
  const back = (weekdayOf(iso) + 1) % 7; // السبت = 0
  return addDays(iso, -back);
}

export function monthGrid(anyDayISO: string): { month: string; days: { iso: string; inMonth: boolean }[] } {
  const month = anyDayISO.slice(0, 7);
  const first = `${month}-01`;
  const start = weekStart(first);
  const days: { iso: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const iso = addDays(start, i);
    days.push({ iso, inMonth: iso.slice(0, 7) === month });
  }
  // أسقط الأسبوع السادس إن كان كله خارج الشهر
  if (!days.slice(35).some((d) => d.inMonth)) days.splice(35);
  return { month, days };
}

export function weekDays(anyDayISO: string): string[] {
  const s = weekStart(anyDayISO);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const to = addDays(`${shiftMonth(month, 1)}-01`, -1);
  return { from, to };
}

// ============================================================
// العرض
// ============================================================
export const LABEL_COLOR_CLASSES: Record<TaskLabelColor, string> = {
  gray: "bg-gray-100 text-gray-700",
  red: "bg-red-100 text-red-700",
  orange: "bg-orange-100 text-orange-700",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-emerald-100 text-emerald-700",
  teal: "bg-teal-100 text-teal-700",
  blue: "bg-blue-100 text-blue-700",
  indigo: "bg-indigo-100 text-indigo-700",
  purple: "bg-purple-100 text-purple-700",
  pink: "bg-pink-100 text-pink-700",
};

export function labelClasses(color: string | null | undefined): string {
  return LABEL_COLOR_CLASSES[(color ?? "gray") as TaskLabelColor] ?? LABEL_COLOR_CLASSES.gray;
}

export function formatMinutes(m: number | null | undefined): string | null {
  if (m == null) return null;
  if (m < 60) return `${m} د`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} س ${r} د` : `${h} س`;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// «قبل ساعتين» — من لحظة (ISO) إلى الآن
export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const diff = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (diff < 60) return "الآن";
  const min = Math.round(diff / 60);
  if (min < 60) return `قبل ${min} دقيقة`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? "قبل ساعة" : h === 2 ? "قبل ساعتين" : `قبل ${h} ساعة`;
  const d = Math.round(h / 24);
  if (d === 1) return "أمس";
  if (d < 30) return `قبل ${d} يوم`;
  return baghdadDate(iso);
}

const FIELD_NAMES: Record<string, string> = {
  title: "العنوان",
  description: "التفاصيل",
  next_step: "الخطوة القادمة",
  follow_up_date: "موعد المتابعة",
  task_type: "النوع",
  entity: "الكيان المرتبط",
  requires_approval: "شرط الموافقة",
  blocked_reason: "سبب التوقّف",
  minutes: "الوقت (تقدير/فعلي)",
};

// سطر السجلّ بالعربية: «عبدالله غيّر الموعد إلى 2026-10-12»
export function activitySentence(a: TaskActivity): string {
  const who = a.actor_name ?? "النظام";
  const nv = a.new_value ?? "";
  const ov = a.old_value ?? "";
  switch (a.action) {
    case "created": return `${who} أنشأ المهمة`;
    case "assigned": return `${who} أسند المهمة إلى ${nv}`;
    case "reassigned": return `${who} نقل المهمة من ${ov || "—"} إلى ${nv}`;
    case "started": return `${who} بدأ التنفيذ`;
    case "completed": return `${who} أنجز المهمة`;
    case "cancelled": return `${who} ألغى المهمة${a.note ? ` — ${a.note}` : ""}`;
    case "restored": return `${who} أعاد فتح المهمة (${nv})`;
    case "status_changed": return `${who} غيّر الحالة من ${ov} إلى ${nv}`;
    case "priority_changed": return `${who} غيّر الأولوية من ${ov} إلى ${nv}`;
    case "due_date_changed": return `${who} غيّر الموعد ${ov ? `من ${ov} ` : ""}إلى ${nv || "بدون موعد"}`;
    case "department_changed": return `${who} نقل المهمة إلى قسم ${nv || "—"}`;
    case "workflow_step_changed": return `${who} نقلها إلى خطوة «${nv}»`;
    case "approval_requested": return `${who} طلب الموافقة`;
    case "approved": return `${who} اعتمد المهمة`;
    case "rejected": return `${who} رفض المهمة${a.note ? ` — ${a.note}` : ""}`;
    case "comment_added": return `${who} علّق: ${a.note ?? ""}`;
    case "attachment_added": return `${who} أرفق «${nv}»`;
    case "attachment_removed": return `${who} حذف المرفق «${ov}»`;
    case "checklist_changed": return `${who} — ${a.note ?? "قائمة التحقق"}: ${nv || ov}`;
    case "dependency_added": return `${who} جعلها تعتمد على «${nv}»`;
    case "dependency_removed": return `${who} أزال اعتمادها على «${ov}»`;
    case "watcher_added": return `${who} أضاف ${nv} متابعاً`;
    case "watcher_removed": return `${who} أزال ${ov} من المتابعين`;
    case "subtask_added": return `${who} أضاف مهمة فرعية «${nv}»`;
    case "archived": return `${who} أرشف المهمة`;
    case "unarchived": return `${who} أخرجها من الأرشيف`;
    case "label_changed": return `${who} غيّر الوسوم`;
    case "edited": {
      const f = FIELD_NAMES[a.field ?? ""] ?? a.field ?? "حقلاً";
      return nv ? `${who} عدّل ${f}: ${nv}` : `${who} مسح ${f}`;
    }
    default: return `${who} — ${a.action}`;
  }
}

// تقدّم المهمة الرئيسية: «٣ / ٥»
export function progressOf(row: Pick<TaskRow, "subtasks_total" | "subtasks_done" | "checklist_total" | "checklist_done">) {
  const total = (row.subtasks_total ?? 0) + (row.checklist_total ?? 0);
  const done = (row.subtasks_done ?? 0) + (row.checklist_done ?? 0);
  return { total, done, pct: total ? Math.round((100 * done) / total) : null };
}

// رسالة خطأ القاعدة بالعربية — والإنجليزية التقنية تُخفى
export function friendlyTaskError(e: { message?: string; hint?: string | null; code?: string } | null | undefined): string {
  if (!e) return "";
  if (e.hint === "version_conflict") return "عُدّلت هذه المهمة بعد أن فتحتها — حدّث الصفحة ثم أعد المحاولة.";
  const m = e.message ?? "";
  if (/[؀-ۿ]/.test(m)) return m;
  if (e.code === "42501" || /permission|row-level security/i.test(m)) return "لا تملك صلاحية هذا الإجراء.";
  if (/violates check constraint/i.test(m)) return "قيمة غير مقبولة — راجع الحقول.";
  return "تعذّر الحفظ — حاول مرة أخرى.";
}
