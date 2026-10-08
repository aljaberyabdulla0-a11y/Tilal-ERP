import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { Task } from "@/lib/types";
import { groupTasks } from "@/lib/tasks";
import { baghdadDate } from "@/lib/time";
import { fill, fmtNumber } from "@/lib/dashboard/format";
import TaskCard from "@/app/dashboard/tasks/task-card";

// ============================================================
// بطاقة «مهامي اليوم» في لوحة التحكم — أول ما يراه الموظف صباحاً.
// تعرض المتأخرة أولاً ثم مهام اليوم، وللمدير سطراً عن متأخرات الفريق.
// النصوص من القاموس (t.dash.work)، و«اليوم» بتوقيت بغداد.
// ============================================================
export default async function TodayTasks() {
  const supabase = await createClient();
  const [user, admin] = await Promise.all([getCurrentUser(), isAdmin()]);
  const { locale, t } = getI18n();
  const w = t.dash.work;
  const myUserId = user?.id ?? "";
  const today = baghdadDate();

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("assigned_to", myUserId)
    .in("status", ["جديدة", "قيد التنفيذ"])
    .lte("due_date", today)
    .order("due_date", { ascending: true })
    .limit(30);

  // جدول المهام غير موجود بعد (لم يُشغَّل sql/031) — لا نكسر اللوحة
  if (error) return null;

  const tasks = (data ?? []) as Task[];
  const groups = groupTasks(tasks, today);
  const list = [...groups.late, ...groups.today];

  // للمدير: كم مهمة متأخرة عند بقية الفريق
  let teamLate = 0;
  if (admin) {
    const { count } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .in("status", ["جديدة", "قيد التنفيذ"])
      .lt("due_date", today)
      .neq("assigned_to", myUserId);
    teamLate = count ?? 0;
  }

  return (
    <section aria-labelledby="today-tasks-title" className="dash-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="today-tasks-title" className="flex items-center gap-2 text-sm font-bold text-ink">
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-brand-600">checklist</span>
          {w.tasksTitle}
          {list.length > 0 && (
            <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">
              {fmtNumber(list.length, locale)}
            </span>
          )}
        </h2>
        <Link href="/dashboard/tasks" className="dash-focus rounded text-xs font-bold text-brand-700 hover:underline">
          {w.allTasks}
        </Link>
      </div>

      {groups.late.length > 0 && (
        <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">assignment_late</span>
          {fill(w.lateBanner, { n: fmtNumber(groups.late.length, locale) })}
        </p>
      )}

      {list.length === 0 ? (
        <div className="py-5 text-center">
          <p className="text-sm text-ink-muted">{w.noTasks}</p>
          <Link
            href="/dashboard/tasks/new"
            className="dash-focus mt-3 inline-flex items-center gap-1 rounded-lg bg-surface-subtle px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">add</span>
            {w.addSelf}
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.slice(0, 6).map((task) => (
            <TaskCard key={task.id} task={task} myUserId={myUserId} todayISO={today} compact />
          ))}
          {list.length > 6 && (
            <Link href="/dashboard/tasks" className="dash-focus block rounded pt-1 text-center text-sm font-medium text-brand-700 hover:underline">
              {fill(w.moreTasks, { n: fmtNumber(list.length - 6, locale) })}
            </Link>
          )}
        </div>
      )}

      {admin && teamLate > 0 && (
        <Link
          href="/dashboard/tasks"
          className="dash-focus mt-3 flex items-center gap-2 rounded-lg bg-warning-50 px-3 py-2 text-sm font-medium text-warning-700 transition hover:bg-warning-100"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">groups</span>
          {fill(w.teamLate, { n: fmtNumber(teamLate, locale) })}
        </Link>
      )}
    </section>
  );
}
