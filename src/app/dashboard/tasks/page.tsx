import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getPeople } from "@/lib/people";
import { Task } from "@/lib/types";
import { groupTasks, followUpsDue, taskCounts } from "@/lib/tasks";
import { getMyFollowUps } from "@/lib/client-followups";
import { baghdadDate } from "@/lib/time";
import ClientFollowUps from "@/components/client-followups";
import QuickAdd from "./quick-add";
import TaskCard from "./task-card";
import EmployeeFilter from "./employee-filter";

// ============================================================
// المهام اليومية — «ماذا سأفعل اليوم؟»
//
// الترتيب مقصود: المتأخرة أولاً، ثم مهام اليوم، ثم القادمة.
// المدير يرى مهام الجميع ويقدر يفلترها بموظف معيّن،
// والموظف يرى مهامه وما طلبه هو (حماية الصفوف تضمن ذلك).
// ============================================================
export default async function TasksPage({
  searchParams,
}: {
  searchParams: { emp?: string; done?: string };
}) {
  const supabase = await createClient();
  const [user, admin, people] = await Promise.all([
    getCurrentUser(),
    isAdmin(),
    getPeople(),
  ]);

  const myUserId = user?.id ?? "";
  const today = baghdadDate();
  const empFilter = admin ? (searchParams.emp ?? "") : "";
  const showDone = searchParams.done === "1";

  // المفتوحة + آخر المنجزة (استعلامان بدل جلب كل التاريخ)
  let openQuery = supabase
    .from("tasks")
    .select("*")
    .in("status", ["جديدة", "قيد التنفيذ"])
    .order("due_date", { ascending: true })
    .limit(300);

  let doneQuery = supabase
    .from("tasks")
    .select("*")
    .in("status", ["منجزة", "ملغاة"])
    .order("updated_at", { ascending: false })
    .limit(30);

  if (empFilter) {
    openQuery = openQuery.eq("assigned_to", empFilter);
    doneQuery = doneQuery.eq("assigned_to", empFilter);
  }

  // متابعات العملاء تُقرأ بالتوازي — نفس الدالة يستدعيها المكوّن أدناه
  // (ملفوفة بـ cache) فلا تتكرّر الرحلة للقاعدة
  const [openRes, doneRes, clientFollow] = await Promise.all([
    openQuery,
    doneQuery,
    getMyFollowUps(),
  ]);

  const openTasks = (openRes.data ?? []) as Task[];
  const doneTasks = (doneRes.data ?? []) as Task[];
  const notReady = Boolean(openRes.error);

  const groups = groupTasks(openTasks, today);
  const follow = followUpsDue(openTasks, today);
  const counts = taskCounts([...openTasks, ...doneTasks], today);

  const kpis = [
    { label: "مهام متأخرة", value: counts.late, icon: "warning", color: "text-red-700 bg-red-50" },
    { label: "مهام اليوم", value: counts.today, icon: "today", color: "text-brand-700 bg-brand-50" },
    { label: "متابعات عملاء", value: clientFollow.total, icon: "groups", color: "text-amber-700 bg-amber-50" },
    { label: "أُنجزت اليوم", value: counts.doneToday, icon: "check_circle", color: "text-emerald-700 bg-emerald-50" },
  ];

  return (
    <main className="p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-brand-900">المهام اليومية</h1>
          <p className="mt-1 text-gray-500">
            كل ما عليك عمله اليوم في مكان واحد — مهامك ومتابعات عملائك.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {admin && <EmployeeFilter people={people} value={empFilter} />}
          <Link
            href="/dashboard/tasks/new"
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            + مهمة بالتفصيل
          </Link>
        </div>
      </header>

      {notReady && (
        <div className="mb-6 rounded-2xl bg-amber-50 p-5 text-amber-800">
          لم تُفعَّل المهام بعد في قاعدة البيانات — شغّل ملف{" "}
          <b dir="ltr">sql/031_tasks.sql</b> في Supabase.
        </div>
      )}

      {/* مؤشرات سريعة */}
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="glass-card p-4">
            <span className={`material-symbols-outlined rounded-lg p-2 ${k.color}`}>
              {k.icon}
            </span>
            <p className="mt-2 text-xs font-bold uppercase text-gray-400">{k.label}</p>
            <h3 className="text-2xl font-bold text-brand-900" dir="ltr">{k.value}</h3>
          </div>
        ))}
      </section>

      {/* إضافة سريعة */}
      <section className="mb-6">
        <QuickAdd people={people} myUserId={myUserId} isAdmin={admin} />
      </section>

      {/* متابعات العملاء — العمل الميداني لليوم (لكل موظف عملاؤه) */}
      <section className="mb-8">
        <ClientFollowUps />
      </section>

      {/* متابعات مكتوبة داخل المهام نفسها */}
      {follow.length > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <h2 className="mb-2 flex items-center gap-2 font-bold text-amber-900">
            <span className="material-symbols-outlined">event_repeat</span>
            متابعات داخل المهام ({follow.length})
          </h2>
          <ul className="space-y-1 text-sm text-amber-900">
            {follow.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">arrow_circle_left</span>
                <b>{t.title}</b>
                {t.next_step ? <span>— {t.next_step}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* الأقسام */}
      <div className="space-y-8">
        <TaskSection
          title="متأخرة"
          icon="warning"
          tone="text-red-700"
          tasks={groups.late}
          myUserId={myUserId}
          today={today}
          showAssignee={admin}
          isAdmin={admin}
          empty="لا توجد مهام متأخرة 👌"
        />
        <TaskSection
          title="مهام اليوم"
          icon="today"
          tone="text-brand-800"
          tasks={groups.today}
          myUserId={myUserId}
          today={today}
          showAssignee={admin}
          isAdmin={admin}
          empty="لا توجد مهام لليوم — أضف واحدة من الأعلى."
        />
        <TaskSection
          title="قادمة"
          icon="upcoming"
          tone="text-gray-700"
          tasks={groups.upcoming}
          myUserId={myUserId}
          today={today}
          showAssignee={admin}
          isAdmin={admin}
          empty="لا توجد مهام قادمة."
        />

        {/* المنجزة — مخفية افتراضياً حتى لا تزحم الشاشة */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold text-emerald-700">
              <span className="material-symbols-outlined">check_circle</span>
              منجزة مؤخراً ({doneTasks.length})
            </h2>
            <Link
              href={`/dashboard/tasks?${new URLSearchParams({
                ...(empFilter ? { emp: empFilter } : {}),
                ...(showDone ? {} : { done: "1" }),
              }).toString()}`}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              {showDone ? "إخفاء" : "عرض"}
            </Link>
          </div>
          {showDone &&
            (doneTasks.length === 0 ? (
              <p className="text-sm text-gray-400">لا توجد مهام منجزة بعد.</p>
            ) : (
              <div className="space-y-3">
                {doneTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    myUserId={myUserId}
                    todayISO={today}
                    showAssignee={admin}
                    canDeleteAny={admin}
                  />
                ))}
              </div>
            ))}
        </section>
      </div>
    </main>
  );
}

// قسم واحد من الأقسام (متأخرة / اليوم / قادمة)
function TaskSection({
  title,
  icon,
  tone,
  tasks,
  myUserId,
  today,
  showAssignee,
  isAdmin: admin,
  empty,
}: {
  title: string;
  icon: string;
  tone: string;
  tasks: Task[];
  myUserId: string;
  today: string;
  showAssignee: boolean;
  isAdmin: boolean;
  empty: string;
}) {
  return (
    <section>
      <h2 className={`mb-3 flex items-center gap-2 text-lg font-bold ${tone}`}>
        <span className="material-symbols-outlined">{icon}</span>
        {title} ({tasks.length})
      </h2>
      {tasks.length === 0 ? (
        <p className="text-sm text-gray-400">{empty}</p>
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              myUserId={myUserId}
              todayISO={today}
              showAssignee={showAssignee}
              canDeleteAny={admin}
            />
          ))}
        </div>
      )}
    </section>
  );
}
