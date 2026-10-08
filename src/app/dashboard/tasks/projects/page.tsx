import Link from "next/link";
import { baghdadDate } from "@/lib/time";
import { addDays, progressOf } from "@/lib/tasks";
import { getTaskOverview, listTasks } from "@/lib/tasks-server";
import { DueLabel, MiniProgress, StatusBadge } from "@/components/tasks/badges";
import { EmptyState, SectionTitle } from "@/components/tasks/work-center-ui";

// ============================================================
// المشاريع: المشروع ← المرحلة (milestone) ← المهمة ← الفرعية.
// الأرقام من task_overview (تجميع في القاعدة، بنطاق السائل)، والمراحل
// مهامّ من نوع milestone وتقدّمها من فرعيتها وقائمة تحققها.
// ============================================================
export default async function ProjectTasksPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const today = baghdadDate();
  const project = typeof searchParams.project === "string" && /^[0-9a-f-]{36}$/i.test(searchParams.project) ? searchParams.project : null;
  const [overview, milestones] = await Promise.all([
    getTaskOverview(addDays(today, -3650), today, project ? { project_id: project } : {}),
    listTasks({ workspace: "projects", task_type: ["milestone"], parent: "top", sort: "due", archived: "include", ...(project ? { project_id: project } : {}) }, 100),
  ]);
  const projects = overview?.by_project ?? [];

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <nav className="mb-2 text-sm text-gray-500" aria-label="مسار التنقّل">
        <Link href="/dashboard/tasks" className="hover:text-brand-700">المهام</Link> ‹ المشاريع
      </nav>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">مهام المشاريع</h1>
        <Link href={`/dashboard/tasks/new?task_type=milestone${project ? `&project_id=${project}` : ""}`}
          className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">+ مرحلة</Link>
      </header>

      <section className="mb-8">
        <SectionTitle icon="foundation" title="المشاريع" count={projects.length} />
        {projects.length === 0 ? (
          <EmptyState icon="foundation" text="لا مهام مرتبطة بمشاريع بعد — اختر المشروع عند إنشاء المهمة." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const total = p.open + p.completed;
              const pct = total ? Math.round((100 * p.completed) / total) : 0;
              return (
                <li key={p.id} className={`dash-card p-4 ${project === p.id ? "ring-2 ring-brand-400" : ""}`}>
                  <Link href={`/dashboard/tasks/projects?project=${p.id}`} className="font-bold text-ink hover:text-brand-700">{p.name}</Link>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    <b dir="ltr">{pct}%</b> · {p.open} مفتوحة · {p.completed} منجزة
                    {p.overdue ? <b className="text-red-700"> · {p.overdue} متأخرة</b> : null}
                  </p>
                  <Link href={`/dashboard/tasks?view=list&project=${p.id}&bucket=open`} className="mt-2 inline-block text-xs text-brand-700 hover:underline">مهام المشروع</Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle icon="flag_circle" title="المراحل" count={milestones.total} />
        {milestones.rows.length === 0 ? (
          <EmptyState icon="flag_circle" text="لا مراحل — المرحلة مهمة من نوع «مرحلة» ومهامها فرعية تحتها." />
        ) : (
          <ol className="space-y-2.5">
            {milestones.rows.map((m) => {
              const pr = progressOf(m);
              return (
                <li key={m.id} className="dash-card flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/tasks/${m.id}`} className="font-semibold text-ink hover:text-brand-700">{m.title}</Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                      {m.project_name && <span>{m.project_name}</span>}
                      <DueLabel date={m.due_date} todayISO={today} late={m.is_late} />
                      <span>{m.assigned_to_name}</span>
                    </p>
                  </div>
                  <MiniProgress done={pr.done} total={pr.total} />
                  <StatusBadge status={m.status} />
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
