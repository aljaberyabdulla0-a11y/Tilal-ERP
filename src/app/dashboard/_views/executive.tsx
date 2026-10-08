import { getI18n } from "@/lib/i18n/server";
import { getProjectOptions, getSourceOptions } from "@/lib/dashboard/data";
import { fill } from "@/lib/dashboard/format";
import type { RawParams } from "@/lib/dashboard/period";
import { DashboardHeader, type QuickAction } from "@/components/dashboard/page-header";
import FilterBar from "@/components/dashboard/filter-bar";
import { Slot } from "@/components/dashboard/slot";
import { GridSkeleton, KpiSkeleton, SectionSkeleton } from "@/components/dashboard/skeleton";
import TodayTasks from "@/components/today-tasks";
import ClientFollowUps from "@/components/client-followups";
import ExecutiveKpis from "../_sections/kpis";
import AttentionSection, { ATTENTION_BY_ROLE } from "../_sections/attention";
import SalesSection from "../_sections/sales";
import FinanceSection from "../_sections/finance";
import CrmSection from "../_sections/crm";
import ProjectsSection from "../_sections/projects";
import MarketingSection from "../_sections/marketing";
import BrokerageSection from "../_sections/brokerage";
import HrSection from "../_sections/hr";
import ActivitySection from "../_sections/activity";
import { DashMain, compareText, rangeText, readFilters } from "./shared";

// ============================================================
// اللوحة التنفيذية — «نظام تشغيل» المدير.
//
// خلال ١٠–٢٠ ثانية: كم بعنا وكم قبضنا (المؤشّرات) ← ما المتعطّل وما
// ينتظر قراري (الانتباه) ← كيف تسير المبيعات والمال والـCRM ← أي
// مشروع أفضل وأيّها متراجع ← التسويق والوساطة والأفراد ← ما حدث اليوم.
//
// كل قسم يُبثّ وحده (Slot = Suspense + حدّ خطأ): الرأس والمُرشِّحات
// تظهر فوراً، والقسم البطيء لا يؤخّر غيره، والفاشل لا يُسقط غيره.
// والمُرشِّحات (فترة/مشروع/فريق/مصدر) تسري على كل ما تحتها.
// ============================================================

export default async function ExecutiveDashboard({ searchParams }: { searchParams: RawParams }) {
  const { t } = getI18n();
  const a = t.dash.actions;
  const [f, projects, sources] = await Promise.all([readFilters(searchParams), getProjectOptions(), getSourceOptions()]);

  const actions: QuickAction[] = [
    { href: "/dashboard/clients/new", label: a.newLead, icon: "person_add" },
    { href: "/dashboard/reservations/new", label: a.newReservation, icon: "key" },
    { href: "/dashboard/tasks/new", label: a.newTask, icon: "add_task" },
    { href: "/dashboard/invoices/new", label: a.newInvoice, icon: "receipt_long" },
    { href: `/dashboard/accounting/moves/new?dir=${encodeURIComponent("صرف")}`, label: a.recordExpense, icon: "payments" },
    { href: "/dashboard/accounting/partners", label: a.partners, icon: "handshake" },
    { href: "/dashboard/chat", label: a.announce, icon: "campaign" },
  ];

  return (
    <DashMain>
      <DashboardHeader subtitle={fill(t.dash.subtitle.executive, { range: rangeText(f) })} actions={actions} />
      <FilterBar
        preset={f.preset} from={f.range.from} to={f.range.to}
        project={f.project} team={f.team} source={f.source}
        projects={projects} teams={projects} sources={sources}
        compareLabel={compareText(f)}
        show={{ project: true, team: true, source: true }}
      />

      <Slot fallback={<><KpiSkeleton size="lg" /><KpiSkeleton /></>}><ExecutiveKpis f={f} finance /></Slot>
      <Slot fallback={null}><AttentionSection projectId={f.project} include={ATTENTION_BY_ROLE.admin} /></Slot>
      <Slot fallback={<GridSkeleton cols={2} height="h-80" />}><SalesSection f={f} /></Slot>
      <Slot fallback={<GridSkeleton cols={2} height="h-72" />}><FinanceSection today={f.today} /></Slot>
      <Slot fallback={<SectionSkeleton height="h-80" />}><CrmSection f={f} /></Slot>
      <Slot fallback={<GridSkeleton cols={3} height="h-56" />}><ProjectsSection f={f} /></Slot>
      <Slot fallback={<SectionSkeleton height="h-48" />}><MarketingSection f={f} /></Slot>
      <Slot fallback={<SectionSkeleton height="h-56" />}><BrokerageSection f={f} /></Slot>
      <Slot fallback={<SectionSkeleton height="h-24" />}><HrSection /></Slot>

      <section aria-label={t.dash.sections.myWork} className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Slot fallback={<SectionSkeleton height="h-96" title={false} />}><ActivitySection projectId={f.project} limit={15} /></Slot>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Slot fallback={<SectionSkeleton height="h-48" title={false} />}><TodayTasks /></Slot>
          <Slot fallback={null}><ClientFollowUps compact /></Slot>
        </div>
      </section>
    </DashMain>
  );
}
