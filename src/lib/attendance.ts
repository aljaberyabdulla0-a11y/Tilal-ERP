// ============================================================
// حسابات الدوام: ساعات العمل، التأخير، الانصراف المبكر، وحالة كل يوم.
// كل الحسابات هنا في مكان واحد حتى تتطابق الأرقام بين الصفحة اليومية
// والتقرير الشهري وسجل الموظف.
// ============================================================

import type { Attendance, CompanySettings, Employee, Leave } from "@/lib/types";
import {
  baghdadDate,
  baghdadMinutesOfDay,
  baghdadMonth,
  baghdadWeekday,
} from "@/lib/time";

// ===== أدوات التاريخ — كلها بتوقيت بغداد وليس توقيت الخادم =====

export function toLocalISO(d: Date): string {
  return baghdadDate(d);
}

export function todayISO(): string {
  return baghdadDate();
}

// الشهر الحالي بصيغة YYYY-MM
export function currentMonth(): string {
  return baghdadMonth();
}

// كل أيام الشهر بصيغة YYYY-MM-DD
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return [];
  const last = new Date(y, m, 0).getDate();
  return Array.from(
    { length: last },
    (_, i) => `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
  );
}

// أول وآخر يوم في الشهر (للاستعلام)
export function monthRange(month: string): { start: string; end: string } {
  const days = daysOfMonth(month);
  return { start: days[0] ?? month + "-01", end: days[days.length - 1] ?? month + "-31" };
}

const WEEKDAY_NAMES = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

export function weekdayName(dateISO: string): string {
  return WEEKDAY_NAMES[baghdadWeekday(dateISO)] ?? "";
}

export const WEEKDAYS = WEEKDAY_NAMES.map((label, value) => ({ value, label }));

// ===== دوام الموظف الفعلي =====
// القاعدة: لو للموظف دوام خاص نستخدمه، وإلا نرجع لدوام الشركة العام.
export type Schedule = {
  start: string;      // "09:00"
  end: string;        // "17:00"
  grace: number;      // دقائق السماح
  days: number[];     // 0=الأحد ... 6=السبت
  custom: boolean;    // هل هو دوام خاص بهذا الموظف؟
};

export function effectiveSchedule(
  employee: Pick<Employee, "work_start_time" | "work_end_time" | "work_days"> | null,
  settings: CompanySettings | null
): Schedule {
  const hasCustomHours = !!(employee?.work_start_time && employee?.work_end_time);
  const hasCustomDays = !!(employee?.work_days && employee.work_days.length > 0);

  return {
    start: (hasCustomHours ? employee!.work_start_time! : settings?.work_start_time ?? "09:00:00").slice(0, 5),
    end: (hasCustomHours ? employee!.work_end_time! : settings?.work_end_time ?? "17:00:00").slice(0, 5),
    grace: settings?.late_grace_minutes ?? 15,
    days: hasCustomDays ? employee!.work_days! : settings?.work_days ?? [0, 1, 2, 3, 4],
    custom: hasCustomHours || hasCustomDays,
  };
}

// دوام الشركة العام (لمن لا نعرف موظفه)
export function companySchedule(settings: CompanySettings | null): Schedule {
  return effectiveSchedule(null, settings);
}

// هل هذا اليوم يوم دوام حسب الجدول؟
export function isWorkDay(dateISO: string, schedule: Schedule): boolean {
  return schedule.days.includes(baghdadWeekday(dateISO));
}

// ===== أدوات الوقت =====

// "09:00:00" → عدد الدقائق من منتصف الليل
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// طابع زمني → دقائق من منتصف الليل **بتوقيت بغداد**
export function stampToMinutes(ts: string | null): number | null {
  if (!ts) return null;
  return baghdadMinutesOfDay(ts);
}

// 545 → "9 ساعات و5 دقائق"
export function formatDuration(minutes: number | null): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  const hPart = h === 0 ? "" : h === 1 ? "ساعة" : h === 2 ? "ساعتان" : `${h} ساعات`;
  const mPart = m === 0 ? "" : `${m} دقيقة`;
  if (hPart && mPart) return `${hPart} و${mPart}`;
  return hPart || mPart;
}

// 545 → "9:05" (للجداول المزدحمة)
export function formatDurationShort(minutes: number | null): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

// ===== حالة اليوم الواحد =====

export type DayStatusKey =
  | "complete"      // بصم ودوامه انتهى
  | "working"       // بصم حضور ولم ينصرف بعد (اليوم نفسه)
  | "missing_out"   // بصم حضور ونسي الانصراف (يوم سابق)
  | "leave"         // إجازة معتمدة
  | "absent"        // يوم دوام بلا بصمة
  | "exempt"        // معفى من البصمة (الإدارة)
  | "off";          // عطلة أسبوعية

export type DayResult = {
  date: string;
  record: Attendance | null;
  status: DayStatusKey;
  statusLabel: string;
  statusColor: string;
  workedMinutes: number | null;   // ساعات العمل الفعلية
  lateMinutes: number;            // دقائق التأخير عن بداية الدوام
  earlyLeaveMinutes: number;      // دقائق الانصراف المبكر
  leave: Leave | null;
};

const STATUS_META: Record<DayStatusKey, { label: string; color: string }> = {
  complete: { label: "مكتمل", color: "bg-green-100 text-green-700" },
  working: { label: "في الدوام", color: "bg-blue-100 text-blue-700" },
  missing_out: { label: "بلا انصراف", color: "bg-amber-100 text-amber-700" },
  leave: { label: "إجازة", color: "bg-purple-100 text-purple-700" },
  absent: { label: "غياب", color: "bg-red-100 text-red-700" },
  exempt: { label: "معفى من البصمة", color: "bg-slate-100 text-slate-600" },
  off: { label: "عطلة", color: "bg-gray-100 text-gray-500" },
};

// هل تغطّي هذه الإجازة المعتمدة هذا اليوم؟
function leaveCovering(date: string, leaves: Leave[]): Leave | null {
  return (
    leaves.find(
      (l) =>
        l.status === "موافق عليها" && l.start_date <= date && l.end_date >= date
    ) ?? null
  );
}

// تقييم يوم واحد لموظف واحد
export function evaluateDay(
  date: string,
  record: Attendance | null,
  leaves: Leave[],
  schedule: Schedule,
  today = todayISO(),
  exempt = false
): DayResult {
  const startM = timeToMinutes(schedule.start) ?? 9 * 60;
  const endM = timeToMinutes(schedule.end) ?? 17 * 60;
  const grace = schedule.grace;

  const inM = stampToMinutes(record?.check_in ?? null);
  const outM = stampToMinutes(record?.check_out ?? null);

  // ساعات العمل = من البصمة إلى الانصراف (لو تجاوز منتصف الليل نضيف يوماً)
  let worked: number | null = null;
  if (inM !== null && outM !== null) {
    worked = outM >= inM ? outM - inM : outM + 1440 - inM;
  }

  const lateMinutes =
    inM !== null && inM > startM + grace ? inM - startM : 0;
  const earlyLeaveMinutes =
    outM !== null && outM < endM ? endM - outM : 0;

  const leave = leaveCovering(date, leaves);
  const workDay = isWorkDay(date, schedule);

  let status: DayStatusKey;
  if (record?.check_in && record?.check_out) status = "complete";
  else if (record?.check_in) status = date === today ? "working" : "missing_out";
  else if (leave) status = "leave";
  else if (!workDay) status = "off";
  // المعفيّون من البصمة (الإدارة) لا يُحتسب عليهم غياب
  else if (exempt) status = "exempt";
  else status = "absent";

  return {
    date,
    record,
    status,
    statusLabel: STATUS_META[status].label,
    statusColor: STATUS_META[status].color,
    workedMinutes: worked,
    lateMinutes,
    earlyLeaveMinutes,
    leave: status === "leave" ? leave : leaveCovering(date, leaves),
  };
}

// ===== ملخّص فترة (شهر) لموظف واحد =====

export type PeriodSummary = {
  presentDays: number;      // أيام فيها بصمة حضور
  completeDays: number;     // أيام مكتملة (حضور + انصراف)
  absentDays: number;       // أيام دوام بلا بصمة ولا إجازة
  leaveDays: number;        // أيام إجازة معتمدة تقع في أيام الدوام
  lateDays: number;         // أيام تأخّر فيها عن بداية الدوام
  missingOutDays: number;   // أيام بصم فيها ونسي الانصراف
  totalMinutes: number;     // إجمالي ساعات العمل
  lateMinutes: number;      // إجمالي دقائق التأخير
  workDays: number;         // عدد أيام الدوام في الفترة
  avgMinutes: number;       // متوسط ساعات اليوم المكتمل
  attendanceRate: number;   // نسبة الحضور من أيام الدوام (٪)
};

export function summarizePeriod(days: DayResult[]): PeriodSummary {
  const s: PeriodSummary = {
    presentDays: 0,
    completeDays: 0,
    absentDays: 0,
    leaveDays: 0,
    lateDays: 0,
    missingOutDays: 0,
    totalMinutes: 0,
    lateMinutes: 0,
    workDays: 0,
    avgMinutes: 0,
    attendanceRate: 0,
  };

  for (const d of days) {
    if (d.status !== "off" && d.status !== "exempt") s.workDays++;
    if (d.record?.check_in) s.presentDays++;
    if (d.status === "complete") s.completeDays++;
    if (d.status === "absent") s.absentDays++;
    if (d.status === "leave") s.leaveDays++;
    if (d.status === "missing_out") s.missingOutDays++;
    if (d.lateMinutes > 0) {
      s.lateDays++;
      s.lateMinutes += d.lateMinutes;
    }
    if (d.workedMinutes) s.totalMinutes += d.workedMinutes;
  }

  s.avgMinutes = s.completeDays > 0 ? Math.round(s.totalMinutes / s.completeDays) : 0;
  s.attendanceRate =
    s.workDays > 0 ? Math.round(((s.presentDays + s.leaveDays) / s.workDays) * 100) : 0;

  return s;
}

// بناء أيام الشهر لموظف واحد ثم تلخيصها
export function buildMonth(
  month: string,
  records: Attendance[],
  leaves: Leave[],
  schedule: Schedule,
  today = todayISO(),
  exempt = false
): { days: DayResult[]; summary: PeriodSummary } {
  const byDate = new Map(records.map((r) => [r.work_date, r]));
  // لا نحاسب على أيام لم تأتِ بعد
  const days = daysOfMonth(month)
    .filter((d) => d <= today)
    .map((d) =>
      evaluateDay(d, byDate.get(d) ?? null, leaves, schedule, today, exempt)
    );

  return { days, summary: summarizePeriod(days) };
}
