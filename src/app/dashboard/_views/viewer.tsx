import { getI18n } from "@/lib/i18n/server";
import { engineCompare, getProjectOptions, getUnits } from "@/lib/dashboard/data";
import { drillHref, engineFilters, type DashFilters, type RawParams } from "@/lib/dashboard/period";
import { fill } from "@/lib/dashboard/format";
import { makeKpi, num, type Kpi } from "@/lib/dashboard/kpi";
import { DashboardHeader } from "@/components/dashboard/page-header";
import FilterBar from "@/components/dashboard/filter-bar";
import { Slot } from "@/components/dashboard/slot";
import { GridSkeleton, KpiSkeleton, SectionSkeleton } from "@/components/dashboard/skeleton";
import { Icon, KpiGrid } from "@/components/dashboard/ui";
import { ErrorState } from "@/components/dashboard/states";
import SalesSection from "../_sections/sales";
import ProjectsSection from "../_sections/projects";
import CrmSection from "../_sections/crm";
import { DashMain, compareText, rangeText, readFilters } from "./shared";

// ============================================================
// لوحة المُطالِع — قراءة فقط (M2).
//
// قد يكون مراجعاً خارجياً: لا بصمة، ولا «عملائي»، ولا «حجز جديد»، ولا
// إجراءات، ولا سجلّ نشاط بأسماء الموظفين، ولا أداء أفراد. نظرةٌ على
// أداء الشركة كما يسمح can_read_all_crm (084) — والمال خارجها.
// ============================================================

async function ViewerKpis({ f }: { f: DashFilters }) {
  const { t } = getI18n();
  const k = t.dash.kpi;
  const [eng, units] = await Promise.all([
    engineCompare(["REVENUE", "WON_DEALS", "RESERVATIONS", "CONVERSION_RATE", "NEW_LEADS", "OPEN_LEADS"], f.range, f.previous, engineFilters(f), f.today),
    getUnits(f.project),
  ]);
  if (!eng.ok) return <ErrorState detail={eng.error} />;
  const { cur, prev } = eng.data;
  const c = (m: string) => num(cur[m]);
  const p = (m: string) => (prev ? num(prev[m]) : undefined);
  const available = units.ok ? units.data.reduce((acc, u) => acc + u.available, 0) : null;
  const kpis: Kpi[] = [
    makeKpi({ key: "rev", title: k.sales, value: c("REVENUE"), unit: "money", direction: "positive", icon: "payments", href: drillHref("REVENUE", f), definition: k.salesDef }, p("REVENUE")),
    makeKpi({ key: "won", title: k.wonDeals, value: c("WON_DEALS"), unit: "count", direction: "positive", icon: "check_circle", href: drillHref("WON_DEALS", f), definition: k.wonDealsDef }, p("WON_DEALS")),
    makeKpi({ key: "res", title: k.reservations, value: c("RESERVATIONS"), unit: "count", direction: "positive", icon: "key", href: drillHref("RESERVATIONS", f), definition: k.reservationsDef }, p("RESERVATIONS")),
    makeKpi({ key: "conv", title: k.conversion, value: c("CONVERSION_RATE"), unit: "pct", direction: "positive", icon: "conversion_path", href: drillHref("CONVERSION_RATE", f), definition: k.conversionDef }, p("CONVERSION_RATE")),
    makeKpi({ key: "leads", title: k.newLeads, value: c("NEW_LEADS"), unit: "count", direction: "positive", icon: "person_add", href: drillHref("NEW_LEADS", f), definition: k.newLeadsDef }, p("NEW_LEADS")),
    makeKpi({ key: "open", title: k.activeLeads, value: c("OPEN_LEADS"), unit: "count", direction: "neutral", icon: "groups", href: drillHref("OPEN_LEADS", f), definition: k.activeLeadsDef }, p("OPEN_LEADS")),
    { key: "avail", title: k.unitsAvailable, value: available, unit: "count", direction: "neutral", icon: "apartment", delta: null, definition: k.unitsAvailableDef },
  ];
  return <div className="mb-6"><KpiGrid kpis={kpis.slice(0, 4)} size="lg" cols={4} label={t.dash.sections.primary} /><div className="mt-3"><KpiGrid kpis={kpis.slice(4)} size="sm" cols={3} label={t.dash.sections.secondary} /></div></div>;
}

export default async function ViewerDashboard({ searchParams }: { searchParams: RawParams }) {
  const { t } = getI18n();
  const [f, projects] = await Promise.all([readFilters(searchParams), getProjectOptions()]);
  return (
    <DashMain>
      <DashboardHeader subtitle={fill(t.dash.subtitle.viewer, { range: rangeText(f) })} />
      <p className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-info-50 px-3 py-1.5 text-xs font-semibold text-info-700">
        <Icon name="visibility" className="text-[16px]" />
        {t.dash.viewer.readOnly}
      </p>
      <FilterBar
        preset={f.preset} from={f.range.from} to={f.range.to}
        project={f.project} team={null} source={null}
        projects={projects} compareLabel={compareText(f)}
        show={{ project: true }}
      />
      <Slot fallback={<><KpiSkeleton size="lg" /><KpiSkeleton size="sm" count={3} /></>}><ViewerKpis f={f} /></Slot>
      <Slot fallback={<GridSkeleton cols={2} height="h-80" />}><SalesSection f={f} /></Slot>
      <Slot fallback={<GridSkeleton cols={3} height="h-56" />}><ProjectsSection f={f} /></Slot>
      <Slot fallback={<SectionSkeleton height="h-72" />}><CrmSection f={f} showOwners={false} /></Slot>
    </DashMain>
  );
}
