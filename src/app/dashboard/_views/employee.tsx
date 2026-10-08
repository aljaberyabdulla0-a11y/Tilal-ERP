import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { tValue } from "@/lib/i18n/values";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/hr";
import { Attendance, CompanySettings, WorkLocation } from "@/lib/types";
import { baghdadDate } from "@/lib/time";
import { getMySummary } from "@/lib/dashboard/data";
import { fmtRelative } from "@/lib/dashboard/format";
import { type Kpi } from "@/lib/dashboard/kpi";
import { DashboardHeader, type QuickAction } from "@/components/dashboard/page-header";
import { Slot } from "@/components/dashboard/slot";
import { KpiSkeleton, SectionSkeleton } from "@/components/dashboard/skeleton";
import { Card, CardTitle, EmptyState, Icon, KpiGrid, StatTile } from "@/components/dashboard/ui";
import { ErrorState } from "@/components/dashboard/states";
import TodayTasks from "@/components/today-tasks";
import ClientFollowUps from "@/components/client-followups";
import CheckInOut from "../me/check-in-out";
import ActivitySection from "../_sections/activity";
import { DashMain } from "./shared";

// ============================================================
// لوحة الموظف — مساحة عملٍ شخصية لا لوحة تنفيذية.
//
// كل رقم فيها له وحده (dashboard_my_summary — 182):
//   «ليداتي» بالمالك owner_id لا بمن أدخل البطاقة created_by (H5): كان
//   موظفٌ أدخل ١١٠ بطاقة يرى ١١٠، وهو لا يملك منها اليوم إلا ٧.
// ولا شيء خارج نطاقه — والقاعدة تضمن ذلك لا هذه الشاشة.
// ============================================================

type Emp = NonNullable<Awaited<ReturnType<typeof getMyEmployee>>>;

async function Attendance_({ emp }: { emp: Emp | null }) {
  const { t } = getI18n();
  if (!emp) {
    return (
      <div role="note" className="mb-6 flex items-start gap-2 rounded-card border border-warning-100 bg-warning-50 p-4 text-sm text-warning-700">
        <Icon name="link_off" />
        {t.dash.employee.noProfile}
      </div>
    );
  }
  if (emp.exempt_from_attendance) {
    return (
      <div className="mb-6 flex items-center gap-2 rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink-secondary">
        <Icon name="verified_user" />
        {t.dash.employee.attendanceExempt}
      </div>
    );
  }
  const supabase = await createClient();
  const [{ data: cfg }, { data: locs }, { data: att }] = await Promise.all([
    supabase.from("company_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("work_locations").select("*").eq("is_active", true),
    supabase.from("attendance").select("*").eq("employee_id", emp.id).eq("work_date", baghdadDate()).maybeSingle(),
  ]);
  return (
    <section className="mb-6">
      <CheckInOut
        employeeId={emp.id}
        todayRecord={(att as Attendance) ?? null}
        settings={(cfg as CompanySettings) ?? null}
        locations={(locs ?? []) as WorkLocation[]}
      />
    </section>
  );
}

async function MyKpis({ empId }: { empId: string | null }) {
  const { t } = getI18n();
  const k = t.dash.kpi;
  const s = t.dash.sections;
  const r = await getMySummary();
  if (!r.ok) return <ErrorState detail={r.error} />;
  const m = r.data;
  const mine = empId ? `owner=${empId}` : "";
  const n = (v: unknown) => Number(v ?? 0);

  const kpis: Kpi[] = [
    { key: "leads", title: k.myLeads, value: n(m.leads_open), unit: "count", direction: "neutral", icon: "groups", delta: null, href: `/dashboard/clients?${mine}`, definition: k.myLeadsDef },
    { key: "fu", title: k.myFollowups, value: n(m.followups_due), unit: "count", direction: "negative", icon: "call", delta: null, href: `/dashboard/clients?${mine}&followup=overdue`, status: n(m.followups_due) > 0 ? "warning" : "good" },
    { key: "hot", title: k.myHot, value: n(m.leads_hot), unit: "count", direction: "neutral", icon: "local_fire_department", delta: null, href: `/dashboard/clients?${mine}&temperature=${encodeURIComponent("ساخن")}` },
    { key: "res", title: k.myReservations, value: n(m.reservations_active), unit: "count", direction: "neutral", icon: "key", delta: null, href: "/dashboard/reservations" },
  ];
  const money: Kpi[] = [
    { key: "sales", title: k.mySalesMonth, value: n(m.sales_month), unit: "count", direction: "positive", icon: "handshake", delta: null, href: "/dashboard/reservations" },
    { key: "cm", title: k.myCommissionMonth, value: n(m.commission_month), unit: "money", direction: "positive", icon: "paid", delta: null, href: "/dashboard/me/salary" },
    { key: "cu", title: k.myCommissionUnpaid, value: n(m.commission_unpaid), unit: "money", direction: "neutral", icon: "account_balance_wallet", delta: null, href: "/dashboard/me/salary" },
  ];

  return (
    <div className="mb-6 space-y-3">
      <KpiGrid kpis={kpis} size="md" cols={4} label={s.primary} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardTitle href="/dashboard/tasks" linkLabel={t.dash.common.viewAll}>{s.priorities}</CardTitle>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label={k.tasksDone} value={n(m.tasks_done_today)} tone="good" href="/dashboard/tasks" />
            <StatTile label={k.tasksPending} value={n(m.tasks_today)} href="/dashboard/tasks" />
            <StatTile label={k.tasksOverdue} value={n(m.tasks_overdue)} tone={n(m.tasks_overdue) > 0 ? "danger" : "neutral"} href="/dashboard/tasks" />
          </div>
        </Card>
        <KpiGrid kpis={money} size="sm" cols={3} label={s.money} />
      </div>
    </div>
  );
}

async function MyRecentLeads({ empId }: { empId: string | null }) {
  const { locale, t } = getI18n();
  const s = t.dash.sections;
  if (!empId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, stage, governorate, owner_assigned_at, created_at")
    .eq("owner_id", empId)
    .is("deleted_at", null)
    .is("merged_into", null)
    .order("owner_assigned_at", { ascending: false, nullsFirst: false })
    .limit(6);
  if (error) return <ErrorState compact detail={error.message} />;
  const rows = (data ?? []) as { id: string; name: string; stage: string | null; governorate: string | null; owner_assigned_at: string | null; created_at: string }[];
  return (
    <Card className="h-full">
      <CardTitle href={`/dashboard/clients?owner=${empId}`} linkLabel={t.dash.common.viewAll}>{s.myClients}</CardTitle>
      {rows.length === 0 ? (
        <EmptyState title={t.dash.employee.noClients} icon="person_search" compact />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/dashboard/clients/${c.id}`} className="dash-focus flex items-center justify-between gap-3 rounded px-1 py-2.5 hover:bg-surface-subtle">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-brand-700">{c.name}</span>
                  <span className="text-xs text-ink-muted">{[tValue(c.stage, locale), c.governorate].filter(Boolean).join(" · ")}</span>
                </span>
                <time className="shrink-0 text-[11px] text-ink-muted" dateTime={c.owner_assigned_at ?? c.created_at}>
                  {fmtRelative(c.owner_assigned_at ?? c.created_at, locale)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default async function EmployeeDashboard() {
  const { t } = getI18n();
  const a = t.dash.actions;
  const emp = await getMyEmployee();
  const actions: QuickAction[] = [
    { href: "/dashboard/clients/new", label: a.newClient, icon: "person_add" },
    { href: "/dashboard/reservations/new", label: a.newReservation, icon: "key" },
    { href: "/dashboard/tasks", label: a.myTasks, icon: "checklist" },
    { href: "/dashboard/me/leaves", label: a.myLeaves, icon: "beach_access" },
    { href: "/dashboard/me/salary", label: a.mySalary, icon: "payments" },
  ];

  return (
    <DashMain>
      <DashboardHeader name={emp?.full_name} subtitle={t.dash.subtitle.employee} actions={actions} />
      <Attendance_ emp={emp} />
      <Slot fallback={<KpiSkeleton />}><MyKpis empId={emp?.id ?? null} /></Slot>
      <div className="mb-6 grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Slot fallback={<SectionSkeleton height="h-48" title={false} />}><TodayTasks /></Slot>
          <Slot fallback={null}><ClientFollowUps compact /></Slot>
        </div>
        <div className="lg:col-span-2">
          <Slot fallback={<SectionSkeleton height="h-64" title={false} />}><MyRecentLeads empId={emp?.id ?? null} /></Slot>
        </div>
      </div>
      <Slot fallback={<SectionSkeleton height="h-72" title={false} />}><ActivitySection projectId={null} limit={8} /></Slot>
    </DashMain>
  );
}
