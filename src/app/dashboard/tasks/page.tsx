import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { baghdadDate, baghdadMinutesOfDay } from "@/lib/time";
import {
  getAssignablePeople, getDepartmentOverview, getTaskCounts, getTaskLookups, getTaskWorkload, listTasks,
} from "@/lib/tasks-server";
import { parsePage, parseTaskFilters, parseView, taskFiltersToParams, toTaskListPayload, withParams } from "@/lib/task-filters";
import { monthRange, weekDays } from "@/lib/tasks";
import ClientFollowUps from "@/components/client-followups";
import Pager from "@/components/pager";
import QuickAdd from "@/components/tasks/quick-add";
import TaskRowCard from "@/components/tasks/task-row-card";
import TaskFilterBar, { type SavedTaskView } from "@/components/tasks/filter-bar";
import TaskListView from "@/components/tasks/list-view";
import BoardView from "@/components/tasks/board-view";
import CalendarView from "@/components/tasks/calendar-view";
import {
  EmptyState, KpiGrid, NotReady, SectionTitle, ViewTabs, myKpis, teamKpis, type ViewTab,
} from "@/components/tasks/work-center-ui";
import type { TaskRow } from "@/lib/types";

const PAGE_SIZE = 40;

// ============================================================
// مركز العمل — «ماذا سأفعل اليوم؟» أولاً، ثم الفريق والأقسام والقوائم.
//
//   عملي     متأخرة ← اليوم ← قادمة ← بدون موعد ← بانتظار ← أُنجزت
//   الفريق   العبء لكل موظف + متأخرات الفريق واليوم (لمن له فريق)
//   الأقسام  نظرة كل قسم مع النزول إلى مساحته (للإدارة ومدراء الأقسام)
//   قائمة · لوحة · تقويم   بالمرشّحات والعروض المحفوظة
//
// كل رقم وكل صفّ من القاعدة (task_counts/task_list) بترقيم من الخادم —
// لا حدّ ٣٠٠ صامت. وRLS تحدّد ما يراه كل شخص.
// ============================================================
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  // رابط الجودة (077) «?filter=orphan» يفتح القائمة مرشَّحة مباشرة
  const view = parseView(searchParams.view, searchParams.filter === "orphan" ? "list" : "mine");
  const filters = parseTaskFilters(searchParams);
  const page = parsePage(searchParams.page);
  const today = baghdadDate();

  const [user, lookups, counts, people] = await Promise.all([
    getCurrentUser(), getTaskLookups(), getTaskCounts(), getAssignablePeople(),
  ]);
  const myUserId = user?.id ?? "";
  const me = people.find((p) => p.is_me);
  const hasTeam = Boolean(counts?.team);
  const isAll = counts?.scope === "all";

  const tabs: ViewTab[] = [
    { key: "mine", label: "عملي", icon: "person" },
    ...(hasTeam ? [{ key: "team", label: "الفريق", icon: "groups" }] : []),
    ...(hasTeam || isAll ? [{ key: "departments", label: "الأقسام", icon: "apartment" }] : []),
    { key: "list", label: "قائمة", icon: "list" },
    { key: "board", label: "لوحة", icon: "view_kanban" },
    { key: "calendar", label: "تقويم", icon: "calendar_month" },
  ];

  const hour = Math.floor(baghdadMinutesOfDay(new Date()) / 60);
  const greeting = hour < 12 ? "صباح الخير" : "مساء الخير";
  const firstName = me?.name?.split(" ")[0] ?? "";
  const mine = counts?.mine;

  // العروض المحفوظة (لصاحبها فقط — RLS)
  const { data: savedRaw } = await supabase.from("task_saved_views").select("id, name, view, filters").order("name");
  const saved = (savedRaw ?? []) as SavedTaskView[];

  const filterBar = (
    <TaskFilterBar
      departments={lookups.departments}
      types={lookups.types}
      sources={lookups.sources}
      labels={lookups.labels}
      people={people}
      projects={lookups.projects}
      savedViews={saved}
    />
  );

  const workspaceDepts = lookups.departments.filter((d) => !d.parent_id && d.workspace && d.code);

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">
            {greeting}{firstName ? ` ${firstName}` : ""}
          </h1>
          {mine ? (
            <p className="mt-1 text-ink-muted">
              لديك اليوم:{" "}
              <b className={mine.late ? "text-red-700" : ""}>{mine.late} متأخرة</b> ·{" "}
              <b>{mine.today} اليوم</b> · {mine.upcoming} قادمة
              {mine.my_approvals ? <> · <b className="text-purple-700">{mine.my_approvals} بانتظار موافقتك</b></> : null}
            </p>
          ) : (
            <p className="mt-1 text-ink-muted">كل ما عليك عمله في مكان واحد.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard/tasks/templates" className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-brand-500">
            القوالب
          </Link>
          <Link href="/dashboard/tasks/reports" className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-brand-500">
            التقارير
          </Link>
          <Link href="/dashboard/tasks/new" className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
            + مهمة بالتفصيل
          </Link>
        </div>
      </header>

      {!lookups.ready && <NotReady />}

      {mine && <KpiGrid items={myKpis(mine)} />}

      {/* مساحات الأقسام */}
      {workspaceDepts.length > 0 && (
        <nav aria-label="مساحات الأقسام" className="mb-4 flex flex-wrap gap-1.5 text-sm">
          {workspaceDepts.map((d) => (
            <Link key={d.id} href={`/dashboard/tasks/dept/${d.code}`}
              className="rounded-full border border-line bg-surface px-3 py-1 text-ink-muted hover:border-brand-400 hover:text-brand-700">
              {d.name_ar}
            </Link>
          ))}
          <Link href="/dashboard/tasks/projects"
            className="rounded-full border border-line bg-surface px-3 py-1 text-ink-muted hover:border-brand-400 hover:text-brand-700">
            المشاريع
          </Link>
        </nav>
      )}

      <ViewTabs tabs={tabs} current={view} basePath="/dashboard/tasks" />

      {view === "mine" && <MyWork today={today} myUserId={myUserId} people={people} lookups={lookups} showDone={searchParams.done === "1"} />}

      {view === "team" && hasTeam && <TeamView today={today} myUserId={myUserId} counts={counts!} />}

      {view === "departments" && <DepartmentsView />}

      {view === "list" && (
        <ListSection filters={filters} page={page} today={today} myUserId={myUserId} people={people} lookups={lookups} filterBar={filterBar} />
      )}

      {view === "board" && (
        <BoardSection filters={filters} today={today} lookups={lookups} filterBar={filterBar} />
      )}

      {view === "calendar" && (
        <CalendarSection filters={filters} today={today} searchParams={searchParams} filterBar={filterBar} />
      )}
    </main>
  );
}

// ===================== عملي =====================
async function MyWork({
  today, myUserId, people, lookups, showDone,
}: {
  today: string; myUserId: string; people: Awaited<ReturnType<typeof getAssignablePeople>>;
  lookups: Awaited<ReturnType<typeof getTaskLookups>>; showDone: boolean;
}) {
  const base = { scope: "mine", split_waiting: true };
  const [late, todayR, upcoming, nodate, waiting, delegated, done] = await Promise.all([
    listTasks({ ...base, bucket: "late" }, 30),
    listTasks({ ...base, bucket: "today" }, 30),
    listTasks({ ...base, bucket: "upcoming", sort: "due" }, 10),
    listTasks({ ...base, bucket: "nodate" }, 10),
    listTasks({ scope: "mine", bucket: "waiting" }, 15),
    listTasks({ scope: "created", bucket: "open", sort: "due" }, 8),
    showDone ? listTasks({ scope: "mine", bucket: "done", sort: "done" }, 20) : Promise.resolve({ rows: [] as TaskRow[], total: 0, error: null }),
  ]);
  const list = "/dashboard/tasks?view=list&scope=mine";
  const card = (t: TaskRow, opts: { assignee?: boolean } = {}) => (
    <TaskRowCard key={t.id} task={t} todayISO={today} myUserId={myUserId} showAssignee={opts.assignee}
      variant={t.client_id || t.opportunity_id ? "sales" : "default"} />
  );

  return (
    <div className="space-y-7">
      <QuickAdd people={people} departments={lookups.departments} todayISO={today} />

      <section>
        <SectionTitle icon="warning" title="متأخرة" count={late.total} tone="text-red-700" href={`${list}&bucket=late`} />
        {late.rows.length ? <div className="space-y-2.5">{late.rows.map((t) => card(t))}</div>
          : <EmptyState icon="sentiment_satisfied" text="لا مهام متأخرة 👌" />}
      </section>

      <section>
        <SectionTitle icon="today" title="اليوم" count={todayR.total} tone="text-brand-800" href={`${list}&bucket=today`} />
        {todayR.rows.length ? <div className="space-y-2.5">{todayR.rows.map((t) => card(t))}</div>
          : <EmptyState icon="today" text="لا مهام لليوم — أضف واحدة من الأعلى." />}
      </section>

      {/* متابعات العملاء — العمل الميداني لليوم */}
      <section><ClientFollowUps project="" params={{}} /></section>

      <section>
        <SectionTitle icon="upcoming" title="قادمة" count={upcoming.total} href={`${list}&bucket=upcoming&sort=due`} />
        {upcoming.rows.length ? <div className="space-y-2.5">{upcoming.rows.map((t) => card(t))}</div>
          : <EmptyState icon="event_available" text="لا مهام قادمة." />}
      </section>

      {nodate.total > 0 && (
        <section>
          <SectionTitle icon="event_busy" title="بدون موعد" count={nodate.total} href={`${list}&bucket=nodate`} />
          <div className="space-y-2.5">{nodate.rows.map((t) => card(t))}</div>
        </section>
      )}

      {waiting.total > 0 && (
        <section>
          <SectionTitle icon="pause_circle" title="بانتظار" count={waiting.total} tone="text-amber-800" href={`${list}&bucket=waiting`} />
          <p className="-mt-1 mb-2 text-xs text-ink-muted">تنتظر موافقة، أو مهمة تعتمد عليها، أو أُوقفت بسبب.</p>
          <div className="space-y-2.5">{waiting.rows.map((t) => card(t))}</div>
        </section>
      )}

      {delegated.total > 0 && (
        <section>
          <SectionTitle icon="outgoing_mail" title="طلبتُها من غيري" count={delegated.total}
            href="/dashboard/tasks?view=list&scope=created&bucket=open" />
          <div className="space-y-2.5">{delegated.rows.map((t) => card(t, { assignee: true }))}</div>
        </section>
      )}

      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-emerald-700">
            <span aria-hidden="true" className="material-symbols-outlined">check_circle</span>
            أُنجزت مؤخراً
          </h2>
          <Link href={showDone ? "/dashboard/tasks" : "/dashboard/tasks?done=1"} className="text-sm font-medium text-brand-700 hover:underline">
            {showDone ? "إخفاء" : "عرض"}
          </Link>
        </div>
        {showDone && (done.rows.length ? <div className="space-y-2.5">{done.rows.map((t) => card(t))}</div>
          : <EmptyState icon="hourglass_empty" text="لا مهام منجزة بعد." />)}
      </section>
    </div>
  );
}

// ===================== الفريق =====================
async function TeamView({ today, myUserId, counts }: {
  today: string; myUserId: string; counts: NonNullable<Awaited<ReturnType<typeof getTaskCounts>>>;
}) {
  const [workload, late, todayR, approvals] = await Promise.all([
    getTaskWorkload(null),
    listTasks({ scope: "team", bucket: "late" }, 20),
    listTasks({ scope: "team", bucket: "today" }, 20),
    listTasks({ bucket: "pending_approval", scope: "approvals" }, 20),
  ]);
  const rows = workload.filter((w) => w.user_id !== myUserId);
  return (
    <div className="space-y-7">
      {counts.team && <KpiGrid items={teamKpis(counts.team)} />}

      {approvals.total > 0 && (
        <section>
          <SectionTitle icon="verified" title="بانتظار موافقتي" count={approvals.total} tone="text-purple-700"
            href="/dashboard/tasks?view=list&scope=approvals" />
          <div className="space-y-2.5">
            {approvals.rows.map((t) => <TaskRowCard key={t.id} task={t} todayISO={today} myUserId={myUserId} showAssignee />)}
          </div>
        </section>
      )}

      <section className="dash-card overflow-hidden">
        <h2 className="border-b border-line px-4 py-3 font-bold text-ink">عبء الفريق</h2>
        <p className="px-4 pt-2 text-xs text-ink-muted">أرقام موضوعية للتوزيع — لا تُقرأ وحدها مؤشراً للأداء.</p>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-400">لا مهام مفتوحة لفريقك.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-subtle text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-start">الموظف</th>
                  <th className="px-2 py-2">مفتوحة</th>
                  <th className="px-2 py-2">متأخرة</th>
                  <th className="px-2 py-2">اليوم</th>
                  <th className="px-2 py-2">هذا الأسبوع</th>
                  <th className="px-2 py-2">قيد التنفيذ</th>
                  <th className="px-2 py-2">بانتظار</th>
                  <th className="px-2 py-2">أُنجزت (٧ أيام)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.user_id} className="border-t border-line">
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/tasks?view=list&assignee=${w.user_id}&bucket=open`} className="font-medium text-brand-700 hover:underline">
                        {w.name}
                      </Link>
                      {w.department_name && <span className="block text-[11px] text-gray-400">{w.department_name}</span>}
                    </td>
                    <td className="num-tabular px-2 py-2 text-center">{w.open_count}</td>
                    <td className={`num-tabular px-2 py-2 text-center ${w.late_count ? "font-bold text-red-700" : ""}`}>
                      <Link href={`/dashboard/tasks?view=list&assignee=${w.user_id}&bucket=late`}>{w.late_count}</Link>
                    </td>
                    <td className="num-tabular px-2 py-2 text-center">{w.today_count}</td>
                    <td className="num-tabular px-2 py-2 text-center">{w.week_count}</td>
                    <td className="num-tabular px-2 py-2 text-center">{w.in_progress_count}</td>
                    <td className="num-tabular px-2 py-2 text-center">{w.waiting_count + w.pending_approval_count}</td>
                    <td className="num-tabular px-2 py-2 text-center">{w.done_7d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <SectionTitle icon="warning" title="متأخرات الفريق" count={late.total} tone="text-red-700" href="/dashboard/tasks?view=list&scope=team&bucket=late" />
        {late.rows.length ? <div className="space-y-2.5">{late.rows.map((t) => <TaskRowCard key={t.id} task={t} todayISO={today} myUserId={myUserId} showAssignee />)}</div>
          : <EmptyState text="لا متأخرات عند الفريق." />}
      </section>

      <section>
        <SectionTitle icon="today" title="مهام الفريق اليوم" count={todayR.total} href="/dashboard/tasks?view=list&scope=team&bucket=today" />
        {todayR.rows.length ? <div className="space-y-2.5">{todayR.rows.map((t) => <TaskRowCard key={t.id} task={t} todayISO={today} myUserId={myUserId} showAssignee />)}</div>
          : <EmptyState text="لا مهام للفريق اليوم." />}
      </section>
    </div>
  );
}

// ===================== الأقسام =====================
async function DepartmentsView() {
  const rows = await getDepartmentOverview();
  const visible = rows.filter((r) => r.open_count + r.done_today + r.pending_approval_count > 0 || r.workspace);
  return (
    <section aria-label="الأقسام" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((d) => (
        <Link key={d.department_id} href={d.code ? `/dashboard/tasks/dept/${d.code}` : `/dashboard/tasks?view=list&dept=${d.department_id}`}
          className="dash-card-link block p-4">
          <h3 className="font-bold text-ink">{d.name}</h3>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div><dt className="text-gray-500">مفتوحة</dt><dd className="num-tabular text-lg font-bold">{d.open_count}</dd></div>
            <div><dt className="text-gray-500">متأخرة</dt><dd className={`num-tabular text-lg font-bold ${d.late_count ? "text-red-700" : ""}`}>{d.late_count}</dd></div>
            <div><dt className="text-gray-500">اليوم</dt><dd className="num-tabular text-lg font-bold">{d.today_count}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-ink-muted">
            الإنجاز (٣٠ يوماً): <b dir="ltr">{d.completion_rate_30d == null ? "—" : `${d.completion_rate_30d}%`}</b>
            {d.pending_approval_count ? ` · ${d.pending_approval_count} بانتظار الموافقة` : ""}
          </p>
        </Link>
      ))}
      {visible.length === 0 && <EmptyState icon="apartment" text="لا أقسام في نطاقك بعد." />}
    </section>
  );
}

// ===================== قائمة =====================
async function ListSection({ filters, page, today, myUserId, people, lookups, filterBar }: {
  filters: ReturnType<typeof parseTaskFilters>; page: number; today: string; myUserId: string;
  people: Awaited<ReturnType<typeof getAssignablePeople>>; lookups: Awaited<ReturnType<typeof getTaskLookups>>;
  filterBar: React.ReactNode;
}) {
  const res = await listTasks(toTaskListPayload(filters), PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const params = { ...taskFiltersToParams(filters), view: "list" };
  return (
    <>
      {filterBar}
      {res.error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">تعذّر تحميل المهام.</p>}
      <TaskListView rows={res.rows} todayISO={today} myUserId={myUserId} people={people}
        departments={lookups.departments} labels={lookups.labels} />
      <Pager total={res.total} page={page} pageSize={PAGE_SIZE} basePath="/dashboard/tasks" params={params} unit="مهمة" />
    </>
  );
}

// ===================== لوحة =====================
async function BoardSection({ filters, today, lookups, filterBar }: {
  filters: ReturnType<typeof parseTaskFilters>; today: string;
  lookups: Awaited<ReturnType<typeof getTaskLookups>>; filterBar: React.ReactNode;
}) {
  // اللوحة: المفتوحة + ما أُنجز في ١٤ يوماً (لا كل التاريخ)
  const [open, recent] = await Promise.all([
    listTasks(toTaskListPayload(filters, { bucket: "open", parent: "top" }), 200),
    listTasks(toTaskListPayload(filters, { bucket: "completed", sort: "done", parent: "top" }), 30),
  ]);
  return (
    <>
      {filterBar}
      {open.total > 200 && (
        <p className="mb-2 text-xs text-amber-700">تُعرض أول ٢٠٠ مهمة مفتوحة من {open.total} — ضيّق المرشّحات أو استعمل القائمة.</p>
      )}
      <BoardView rows={[...open.rows, ...recent.rows]} todayISO={today} />
      {lookups.workflows.length > 0 && (
        <p className="mt-2 text-xs text-ink-muted">لوحات المسارات (المحتوى، التصميم) في مساحة التسويق.</p>
      )}
    </>
  );
}

// ===================== تقويم =====================
async function CalendarSection({ filters, today, searchParams, filterBar }: {
  filters: ReturnType<typeof parseTaskFilters>; today: string;
  searchParams: Record<string, string | string[] | undefined>; filterBar: React.ReactNode;
}) {
  const rawDate = typeof searchParams.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date) ? searchParams.date : today;
  const mode = searchParams.cal === "week" ? "week" : "month";
  const range = mode === "month" ? monthRange(rawDate.slice(0, 7)) : (() => {
    const d = weekDays(rawDate);
    return { from: d[0], to: d[6] };
  })();
  // الشبكة تبدأ قبل الشهر بأيام: نوسّع المدى أسبوعاً من كل جهة
  const res = await listTasks(toTaskListPayload({ ...filters, from: undefined, to: undefined },
    { due_from: mode === "month" ? weekDays(range.from)[0] : range.from, due_to: mode === "month" ? weekDays(range.to)[6] : range.to, sort: "due" }), 200);
  const params: Record<string, string> = { ...taskFiltersToParams(filters), view: "calendar" };
  if (mode === "week") params.cal = "week";
  if (typeof searchParams.date === "string") params.date = rawDate;
  return (
    <>
      {filterBar}
      <CalendarView rows={res.rows} todayISO={today} anchor={rawDate} mode={mode} basePath="/dashboard/tasks" params={params} />
      {res.total > 200 && (
        <p className="mt-2 text-xs text-amber-700">
          في هذه الفترة {res.total} مهمة؛ تُعرض أول ٢٠٠. <Link className="underline" href={withParams("/dashboard/tasks", { ...taskFiltersToParams(filters), view: "list", from: range.from, to: range.to })}>افتحها قائمةً</Link>.
        </p>
      )}
    </>
  );
}
