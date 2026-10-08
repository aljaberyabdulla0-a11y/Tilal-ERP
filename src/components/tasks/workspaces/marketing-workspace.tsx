import Link from "next/link";
import { getTaskWorkload, listTasks, type TaskLookups } from "@/lib/tasks-server";
import { monthRange, weekDays } from "@/lib/tasks";
import BoardView from "../board-view";
import CalendarView from "../calendar-view";
import TaskListView from "../list-view";
import { EmptyState, SectionTitle, ViewTabs } from "../work-center-ui";
import type { AssignablePerson, TaskRow } from "@/lib/types";

const CONTENT_TYPES = ["content", "copywriting", "design", "video", "photography", "publishing"];

// ============================================================
// متتبّع التسويق — المحرّك نفسه (tasks) بواجهة التسويق:
//
//   المتتبّع       لوحة بخطوات «خطّ المحتوى» (فكرة ← … ← منشورة)، لا بالحالات
//                  العامة. الحالة العامة تتبع الخطوة (192).
//   الحملات        كل حملة ونسبة إنجاز مهامها
//   خطّ المحتوى    مهام المحتوى/التصميم/الفيديو/النشر وحدها
//   التقويم        مواعيد المهام التسويقية
//   الموافقات      ما ينتظر قرار مدير التسويق
//   عبء الفريق     المفتوح والمتأخر لكل عضو
// ============================================================
export default async function MarketingWorkspace({
  tab, todayISO, myUserId, deptId, lookups, people, searchParams, basePath,
}: {
  tab: string;
  todayISO: string;
  myUserId: string;
  deptId: string;
  lookups: TaskLookups;
  people: AssignablePerson[];
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
}) {
  const ws = { workspace: "marketing" };
  const pipeline = lookups.workflows.find((w) => w.code === "content_pipeline");
  const steps = (pipeline?.steps ?? []).map((s) => ({ id: s.id, name_ar: s.name_ar, position: s.position, color: s.color }));

  const tabs = [
    { key: "tracker", label: "المتتبّع", icon: "view_kanban" },
    { key: "campaigns", label: "الحملات", icon: "flag" },
    { key: "content", label: "خطّ المحتوى", icon: "article" },
    { key: "calendar", label: "التقويم", icon: "calendar_month" },
    { key: "approvals", label: "الموافقات", icon: "verified" },
    { key: "list", label: "قائمة", icon: "list" },
    { key: "workload", label: "عبء الفريق", icon: "groups" },
  ];
  const current = tabs.some((t) => t.key === tab) ? tab : "tracker";

  return (
    <div>
      <ViewTabs tabs={tabs} current={current} basePath={basePath} param="tab" />
      {current === "tracker" && <Tracker ws={ws} steps={steps} todayISO={todayISO} />}
      {current === "campaigns" && <Campaigns ws={ws} />}
      {current === "content" && <ContentPipeline ws={ws} steps={steps} todayISO={todayISO} />}
      {current === "calendar" && <MktCalendar ws={ws} todayISO={todayISO} searchParams={searchParams} basePath={basePath} />}
      {current === "approvals" && <Approvals ws={ws} todayISO={todayISO} myUserId={myUserId} people={people} lookups={lookups} />}
      {current === "list" && <MktList ws={ws} todayISO={todayISO} myUserId={myUserId} people={people} lookups={lookups} />}
      {current === "workload" && <Workload deptId={deptId} />}
    </div>
  );
}

// اللوحة: المفتوحة + ما اكتمل في المسار مؤخراً — بالخطوات إن وُجد المسار
async function Tracker({ ws, steps, todayISO }: { ws: Record<string, unknown>; steps: { id: string; name_ar: string; position: number; color: string }[]; todayISO: string }) {
  const [open, done] = await Promise.all([
    listTasks({ ...ws, bucket: "open", parent: "top" }, 200),
    listTasks({ ...ws, bucket: "completed", sort: "done", parent: "top" }, 20),
  ]);
  const rows = [...open.rows, ...done.rows];
  const inFlow = rows.filter((r) => r.workflow_step_id && steps.some((s) => s.id === r.workflow_step_id));
  const outFlow = rows.filter((r) => !inFlow.includes(r));
  return (
    <div className="space-y-6">
      {steps.length > 0 && (
        <section>
          <SectionTitle icon="linear_scale" title="خطّ المحتوى" count={inFlow.length} />
          {inFlow.length ? <BoardView rows={inFlow} todayISO={todayISO} steps={steps} />
            : <EmptyState icon="lightbulb" text="لا مهام على خطّ المحتوى — ابدأ بفكرة أو بقالب «فيديو تسويقي»." />}
        </section>
      )}
      <section>
        <SectionTitle icon="view_kanban" title="مهام التسويق الأخرى" count={outFlow.length} />
        {outFlow.length ? <BoardView rows={outFlow} todayISO={todayISO} /> : <EmptyState text="لا مهام تسويق أخرى مفتوحة." />}
      </section>
    </div>
  );
}

async function Campaigns({ ws }: { ws: Record<string, unknown> }) {
  const [open, closed] = await Promise.all([
    listTasks({ ...ws, bucket: "open", sort: "due" }, 200),
    listTasks({ ...ws, bucket: "completed", sort: "done" }, 200),
  ]);
  const by = new Map<string, { name: string; open: number; done: number; late: number; next: TaskRow | null }>();
  for (const r of [...open.rows, ...closed.rows]) {
    if (!r.campaign_id) continue;
    const x = by.get(r.campaign_id) ?? { name: r.campaign_name ?? "حملة", open: 0, done: 0, late: 0, next: null };
    if (r.status === "منجزة") x.done += 1;
    else {
      x.open += 1;
      if (r.is_late) x.late += 1;
      if (!x.next || (r.due_date ?? "9") < (x.next.due_date ?? "9")) x.next = r;
    }
    by.set(r.campaign_id, x);
  }
  const list = Array.from(by.entries()).sort((a, b) => b[1].open - a[1].open);
  if (!list.length) {
    return <EmptyState icon="flag" text="لا مهام مرتبطة بحملات بعد — اربط المهمة بحملة، أو فعّل قاعدة «خطة إطلاق لكل حملة» من الإعدادات." />;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map(([id, c]) => {
        const total = c.open + c.done;
        const pct = total ? Math.round((100 * c.done) / total) : 0;
        return (
          <li key={id} className="dash-card p-4">
            <Link href={`/dashboard/marketing/campaigns/${id}`} className="font-bold text-ink hover:text-brand-700">{c.name}</Link>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              <b dir="ltr">{pct}%</b> · {c.done} من {total} منجزة{c.late ? <span className="text-red-700"> · {c.late} متأخرة</span> : null}
            </p>
            {c.next && <p className="mt-1 truncate text-xs text-gray-500">التالي: <Link href={`/dashboard/tasks/${c.next.id}`} className="text-brand-700">{c.next.title}</Link></p>}
            <Link href={`/dashboard/tasks?view=list&campaign=${id}`} className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">كل مهام الحملة</Link>
          </li>
        );
      })}
    </ul>
  );
}

async function ContentPipeline({ ws, steps, todayISO }: { ws: Record<string, unknown>; steps: { id: string; name_ar: string; position: number; color: string }[]; todayISO: string }) {
  const res = await listTasks({ ...ws, bucket: "open", task_type: CONTENT_TYPES }, 200);
  return res.rows.length
    ? <BoardView rows={res.rows} todayISO={todayISO} steps={steps.length ? steps : undefined} />
    : <EmptyState icon="article" text="لا مهام محتوى مفتوحة." />;
}

async function MktCalendar({ ws, todayISO, searchParams, basePath }: {
  ws: Record<string, unknown>; todayISO: string; searchParams: Record<string, string | string[] | undefined>; basePath: string;
}) {
  const anchor = typeof searchParams.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date) ? searchParams.date : todayISO;
  const mode = searchParams.cal === "week" ? "week" : "month";
  const r = monthRange(anchor.slice(0, 7));
  const from = mode === "month" ? weekDays(r.from)[0] : weekDays(anchor)[0];
  const to = mode === "month" ? weekDays(r.to)[6] : weekDays(anchor)[6];
  const res = await listTasks({ ...ws, due_from: from, due_to: to, sort: "due" }, 200);
  const params: Record<string, string> = { tab: "calendar" };
  if (mode === "week") params.cal = "week";
  return <CalendarView rows={res.rows} todayISO={todayISO} anchor={anchor} mode={mode} basePath={basePath} params={params} />;
}

async function Approvals({ ws, todayISO, myUserId, people, lookups }: {
  ws: Record<string, unknown>; todayISO: string; myUserId: string; people: AssignablePerson[]; lookups: TaskLookups;
}) {
  const res = await listTasks({ ...ws, bucket: "pending_approval", sort: "due" }, 50);
  return <TaskListView rows={res.rows} todayISO={todayISO} myUserId={myUserId} people={people}
    departments={lookups.departments} labels={lookups.labels} empty="لا شيء بانتظار الموافقة." />;
}

async function MktList({ ws, todayISO, myUserId, people, lookups }: {
  ws: Record<string, unknown>; todayISO: string; myUserId: string; people: AssignablePerson[]; lookups: TaskLookups;
}) {
  const res = await listTasks({ ...ws, bucket: "open" }, 100);
  return (
    <>
      <TaskListView rows={res.rows} todayISO={todayISO} myUserId={myUserId} people={people}
        departments={lookups.departments} labels={lookups.labels} empty="لا مهام تسويق مفتوحة." />
      {res.total > 100 && (
        <Link href="/dashboard/tasks?view=list&workspace=marketing&bucket=open" className="mt-3 inline-block text-sm text-brand-700 hover:underline">
          عرض الكل ({res.total})
        </Link>
      )}
    </>
  );
}

async function Workload({ deptId }: { deptId: string }) {
  const rows = await getTaskWorkload(deptId);
  if (!rows.length) return <EmptyState icon="groups" text="لا مهام مفتوحة لفريق التسويق." />;
  const max = Math.max(...rows.map((r) => r.open_count), 1);
  return (
    <section className="dash-card p-4">
      <p className="mb-3 text-xs text-ink-muted">العبء للتوزيع العادل — لا يُقرأ وحده مؤشراً للأداء.</p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.user_id}>
            <div className="flex items-center justify-between text-sm">
              <Link href={`/dashboard/tasks?view=list&workspace=marketing&assignee=${r.user_id}&bucket=open`} className="font-medium text-ink hover:text-brand-700">{r.name}</Link>
              <span className="text-xs text-ink-muted">
                {r.open_count} مفتوحة{r.late_count ? <b className="text-red-700"> · {r.late_count} متأخرة</b> : null} · {r.done_7d} أُنجزت هذا الأسبوع
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
              <div className={`h-full rounded-full ${r.late_count ? "bg-red-400" : "bg-brand-500"}`} style={{ width: `${(100 * r.open_count) / max}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
