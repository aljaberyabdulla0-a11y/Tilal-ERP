import { getI18n } from "@/lib/i18n/server";
import { getMyEmployee } from "@/lib/hr";
import { getOwnerLoad, getTeamPerformance } from "@/lib/crm";
import { engineCompare, getProjectOptions, getSourceOptions } from "@/lib/dashboard/data";
import { drillHref, engineFilters, reportHref, type DashFilters, type RawParams } from "@/lib/dashboard/period";
import { fill } from "@/lib/dashboard/format";
import { makeKpi, num, type Kpi } from "@/lib/dashboard/kpi";
import { DashboardHeader, type QuickAction } from "@/components/dashboard/page-header";
import FilterBar from "@/components/dashboard/filter-bar";
import { Slot } from "@/components/dashboard/slot";
import { GridSkeleton, KpiSkeleton, SectionSkeleton } from "@/components/dashboard/skeleton";
import { Card, CardTitle, DashboardSection, EmptyState, KpiGrid } from "@/components/dashboard/ui";
import { BarList } from "@/components/dashboard/charts";
import DataTable, { type Column, type Row } from "@/components/dashboard/data-table";
import { ErrorState } from "@/components/dashboard/states";
import TodayTasks from "@/components/today-tasks";
import ClientFollowUps from "@/components/client-followups";
import AttentionSection, { ATTENTION_BY_ROLE } from "../_sections/attention";
import SalesSection from "../_sections/sales";
import CrmSection from "../_sections/crm";
import ActivitySection from "../_sections/activity";
import { DashMain, compareText, rangeText, readFilters } from "./shared";

// ============================================================
// لوحة المشرف — لا لوحة الموظف (M1).
//
// نطاقه تفرضه القاعدة لا هذه الشاشة: crm_kpis و crm_team_performance
// و crm_report_query كلها تقصر المشرف على مشروعه (095، 101). فلا شرط
// «مشروعي» هنا — ولو عُدّل الرابط يدوياً لما تجاوز نطاقه.
//
// سؤالها: كيف يؤدي فريقي في هذه الفترة؟ ومن يحتاج دعماً الآن؟
// ============================================================

const TEAM_METRICS = ["REVENUE", "WON_DEALS", "NEW_LEADS", "CONVERSION_RATE", "RESERVATIONS", "TOTAL_ACTIVITIES", "OVERDUE", "SLA_BREACH_OPEN"];

async function SupervisorKpis({ f }: { f: DashFilters }) {
  const { t } = getI18n();
  const k = t.dash.kpi;
  const eng = await engineCompare(TEAM_METRICS, f.range, f.previous, engineFilters(f), f.today);
  if (!eng.ok) return <ErrorState detail={eng.error} />;
  const { cur, prev } = eng.data;
  const c = (m: string) => num(cur[m]);
  const p = (m: string) => (prev ? num(prev[m]) : undefined);
  const row1: Kpi[] = [
    makeKpi({ key: "rev", title: k.sales, value: c("REVENUE"), unit: "money", direction: "positive", icon: "payments", href: drillHref("REVENUE", f), definition: k.salesDef }, p("REVENUE")),
    makeKpi({ key: "won", title: k.wonDeals, value: c("WON_DEALS"), unit: "count", direction: "positive", icon: "check_circle", href: drillHref("WON_DEALS", f), definition: k.wonDealsDef }, p("WON_DEALS")),
    makeKpi({ key: "leads", title: k.newLeads, value: c("NEW_LEADS"), unit: "count", direction: "positive", icon: "person_add", href: drillHref("NEW_LEADS", f), definition: k.newLeadsDef }, p("NEW_LEADS")),
    makeKpi({ key: "conv", title: k.conversion, value: c("CONVERSION_RATE"), unit: "pct", direction: "positive", icon: "conversion_path", href: drillHref("CONVERSION_RATE", f), definition: k.conversionDef }, p("CONVERSION_RATE")),
  ];
  const overdue = c("OVERDUE");
  const sla = c("SLA_BREACH_OPEN");
  const row2: Kpi[] = [
    makeKpi({ key: "res", title: k.reservations, value: c("RESERVATIONS"), unit: "count", direction: "positive", icon: "key", href: drillHref("RESERVATIONS", f), definition: k.reservationsDef }, p("RESERVATIONS")),
    makeKpi({ key: "acts", title: k.activities, value: c("TOTAL_ACTIVITIES"), unit: "count", direction: "positive", icon: "call", href: drillHref("TOTAL_ACTIVITIES", f), definition: k.activitiesDef }, p("TOTAL_ACTIVITIES")),
    makeKpi({ key: "overdue", title: k.overdue, value: overdue, unit: "count", direction: "negative", icon: "event_busy", href: drillHref("OVERDUE", f), status: overdue ? "warning" : "good" }, p("OVERDUE")),
    makeKpi({ key: "sla", title: k.slaBreaches, value: sla, unit: "count", direction: "negative", icon: "timer_off", href: drillHref("SLA_BREACH_OPEN", f), status: sla ? "danger" : "good" }, p("SLA_BREACH_OPEN")),
  ];
  return (
    <div className="mb-6 space-y-3">
      <KpiGrid kpis={row1} size="lg" cols={4} label={t.dash.sections.primary} />
      <KpiGrid kpis={row2} size="sm" cols={4} label={t.dash.sections.operational} />
    </div>
  );
}

// جدول الفريق: الأداء (095) + الحِمل (073) لكل موظف، وحالةٌ بأيقونة ونصّ
async function TeamSection({ f }: { f: DashFilters }) {
  const { t } = getI18n();
  const s = t.dash.sections;
  const tt = t.dash.table;
  const st = t.dash.status;
  const [perf, load] = await Promise.all([
    getTeamPerformance({ from: f.range.from, to: f.range.to, teamId: f.team ?? f.project }),
    getOwnerLoad(),
  ]);
  const loadBy = new Map(load.map((l) => [l.owner_id, l]));
  const weekAgo = Date.now() - 7 * 86400000;

  const rows: Row[] = perf.map((r) => {
    const l = loadBy.get(r.owner_id);
    const silent = l && Number(l.open_leads) > 0 && (!l.last_activity || new Date(l.last_activity).getTime() < weekAgo);
    const [tone, label] = l?.over_capacity
      ? ["danger", st.overloaded]
      : silent
      ? ["warning", st.silent]
      : Number(r.overdue) > 0
      ? ["warning", st.warning]
      : ["good", st.onTrack];
    return {
      _id: r.owner_id,
      _href: `/dashboard/clients?owner=${r.owner_id}`,
      name: r.owner_name,
      leads: Number(r.leads_received),
      open: l ? Number(l.open_leads) : null,
      won: Number(r.won),
      conversion: Number(r.conversion_rate),
      activities: Number(r.activities),
      overdue: Number(r.overdue),
      unworked: Number(r.unworked),
      wonValue: Number(r.won_value),
      status: label,
      tone,
    };
  });

  const cols: Column[] = [
    { key: "name", label: tt.employee, primary: true },
    { key: "leads", label: tt.leads, kind: "number" },
    { key: "open", label: tt.open, kind: "number", hideOnMobile: true },
    { key: "won", label: tt.won, kind: "number" },
    { key: "conversion", label: tt.conversion, kind: "pct" },
    { key: "activities", label: tt.activities, kind: "number", hideOnMobile: true },
    { key: "overdue", label: tt.overdue, kind: "number" },
    { key: "unworked", label: tt.unworked, kind: "number", defaultHidden: true },
    { key: "wonValue", label: tt.wonValue, kind: "money", defaultHidden: true },
    { key: "status", label: tt.status, kind: "badge", toneKey: "tone" },
  ];

  const ranking = [...perf]
    .sort((a, b) => Number(b.won_value) - Number(a.won_value) || Number(b.won) - Number(a.won))
    .map((r) => ({ key: r.owner_id, label: r.owner_name, value: Number(r.won_value), sub: `${tt.won}: ${r.won} · ${tt.conversion}: ${r.conversion_rate}%`, href: `/dashboard/clients?owner=${r.owner_id}` }));

  return (
    <DashboardSection id="team" title={s.team} hint={s.teamHint} href={reportHref("salesperson_productivity", f)} linkLabel={t.dash.common.seeReport}>
      {rows.length === 0 ? (
        <div className="dash-card"><EmptyState title={t.dash.common.empty} icon="groups" /></div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <DataTable caption={s.team} columns={cols} rows={rows} exportName="team-performance" initialSort={{ key: "won", dir: "desc" }} />
          </Card>
          <Card>
            <CardTitle>{s.ranking}</CardTitle>
            <BarList title={s.ranking} unit="money" rows={ranking} limit={8} />
          </Card>
        </div>
      )}
    </DashboardSection>
  );
}

export default async function SupervisorDashboard({ searchParams }: { searchParams: RawParams }) {
  const { t } = getI18n();
  const a = t.dash.actions;
  const [f, emp, projects, sources] = await Promise.all([
    readFilters(searchParams), getMyEmployee(), getProjectOptions(), getSourceOptions(),
  ]);

  const actions: QuickAction[] = [
    { href: "/dashboard/clients/new", label: a.newLead, icon: "person_add" },
    { href: "/dashboard/tasks/new", label: a.newTask, icon: "add_task" },
    { href: "/dashboard/team", label: a.teamPage, icon: "supervisor_account" },
    { href: "/dashboard/brokers/requests", label: a.brokerRequests, icon: "real_estate_agent" },
    { href: "/dashboard/crm/reports", label: a.reports, icon: "bar_chart" },
  ];

  return (
    <DashMain>
      <DashboardHeader name={emp?.full_name} subtitle={fill(t.dash.subtitle.supervisor, { range: rangeText(f) })} actions={actions} />
      <FilterBar
        preset={f.preset} from={f.range.from} to={f.range.to}
        project={f.project} team={null} source={f.source}
        projects={projects} sources={sources}
        compareLabel={compareText(f)}
        show={{ project: projects.length > 1, source: true }}
      />
      <Slot fallback={<><KpiSkeleton size="lg" /><KpiSkeleton size="sm" /></>}><SupervisorKpis f={f} /></Slot>
      <Slot fallback={null}><AttentionSection projectId={f.project} include={ATTENTION_BY_ROLE.supervisor} /></Slot>
      <Slot fallback={<SectionSkeleton height="h-96" />}><TeamSection f={f} /></Slot>
      <Slot fallback={<GridSkeleton cols={2} height="h-80" />}><SalesSection f={f} /></Slot>
      <Slot fallback={<SectionSkeleton height="h-72" />}><CrmSection f={f} showOwners={false} /></Slot>
      <section aria-label={t.dash.sections.myWork} className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Slot fallback={<SectionSkeleton height="h-48" title={false} />}><TodayTasks /></Slot>
          <Slot fallback={null}><ClientFollowUps compact /></Slot>
        </div>
        <div className="lg:col-span-3">
          <Slot fallback={<SectionSkeleton height="h-96" title={false} />}><ActivitySection projectId={f.project} limit={12} /></Slot>
        </div>
      </section>
    </DashMain>
  );
}
