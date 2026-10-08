import { getI18n } from "@/lib/i18n/server";
import { canReadMarketing } from "@/lib/auth";
import { getBreakdown, getFunnel as getMktFunnel, getKpisFor, getTrend } from "@/lib/marketing";
import { getDimLabels } from "@/lib/crm-reporting";
import { engineBy, getProjectOptions } from "@/lib/dashboard/data";
import { drillHref, engineFilters, type DashFilters, type RawParams } from "@/lib/dashboard/period";
import { fill, fmtBucket } from "@/lib/dashboard/format";
import { makeKpi, num, type Kpi } from "@/lib/dashboard/kpi";
import { DashboardHeader, type QuickAction } from "@/components/dashboard/page-header";
import FilterBar from "@/components/dashboard/filter-bar";
import { Slot } from "@/components/dashboard/slot";
import { GridSkeleton, KpiSkeleton, SectionSkeleton } from "@/components/dashboard/skeleton";
import { Card, CardTitle, DashboardSection, EmptyState, Icon, KpiGrid } from "@/components/dashboard/ui";
import { BarList, Funnel, TrendChart } from "@/components/dashboard/charts";
import DataTable, { type Column, type Row } from "@/components/dashboard/data-table";
import { ErrorState } from "@/components/dashboard/states";
import { marketingKpis, mktFilters } from "../_sections/marketing";
import { DashMain, compareText, rangeText, readFilters } from "./shared";

// ============================================================
// لوحة التسويق — لا لوحة الموظف (M2): لا بصمة ولا «عملائي» ولا
// «حجز جديد». سؤالها: كم صرفنا، ماذا جلب، وأين الأفضل؟
//
// المصدر وحدة التسويق (125) كما هي: mkt_kpis للفترتين، mkt_breakdown
// للقنوات والحملات، mkt_funnel، mkt_trend. والليدات حسب مصدر الـCRM
// من محرّك التقارير. أرقام المال تحجبها الدوال عمّن لا يملكها.
// ============================================================

async function MarketingKpiRows({ f }: { f: DashFilters }) {
  const { t } = getI18n();
  const k = t.dash.kpi;
  const mf = mktFilters(f);
  const [cur, prev] = await Promise.all([
    getKpisFor({ from: f.range.from, to: f.range.to }, mf),
    f.previous ? getKpisFor(f.previous, mf) : Promise.resolve(null),
  ]);
  if (!cur) return <ErrorState />;
  const p = (v: unknown) => (prev ? num(v) : undefined);
  const row2: Kpi[] = [
    makeKpi({ key: "q", title: k.qualified, value: num(cur.qualified), unit: "count", direction: "positive", icon: "verified" }, p(prev?.qualified)),
    makeKpi({ key: "res", title: k.reservations, value: num(cur.reservations), unit: "count", direction: "positive", icon: "key" }, p(prev?.reservations)),
    makeKpi({ key: "sales", title: k.mktSales, value: num(cur.sales), unit: "count", direction: "positive", icon: "handshake" }, p(prev?.sales)),
    makeKpi({ key: "comm", title: k.mktRevenue, value: num(cur.commission), unit: "money", direction: "positive", icon: "paid", href: "/dashboard/marketing/executive" }, p(prev?.commission)),
  ];
  return (
    <div className="mb-6 space-y-3">
      <KpiGrid kpis={marketingKpis(cur, prev, k)} size="lg" cols={4} label={t.dash.sections.primary} />
      <KpiGrid kpis={row2} size="sm" cols={4} label={t.dash.sections.secondary} />
    </div>
  );
}

async function MarketingTrendAndFunnel({ f }: { f: DashFilters }) {
  const { locale, t } = getI18n();
  const s = t.dash.sections;
  const mf = mktFilters(f);
  const prevMf = f.previous ? { ...mf, from: f.previous.from, to: f.previous.to } : null;
  const [trend, prevTrend, funnel] = await Promise.all([
    getTrend(f.grain, mf),
    prevMf ? getTrend(f.grain, prevMf) : Promise.resolve(null),
    getMktFunnel(mf),
  ]);
  const prevRows = prevTrend?.data ?? [];
  const points = (trend.data ?? []).map((r, i) => ({
    key: r.period,
    label: fmtBucket(r.period, f.grain, locale),
    current: Number(r.leads),
    previous: prevRows[i] ? Number(prevRows[i].leads) : null,
  }));
  const steps = (funnel.data ?? []).map((st) => ({
    key: st.code, label: st.label, value: Number(st.value),
    conversion: st.from_previous === null ? null : Number(st.from_previous),
  }));
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardTitle href="/dashboard/marketing/analytics" linkLabel={t.dash.common.details}>{t.dash.kpi.leads}</CardTitle>
        {trend.error ? <ErrorState compact detail={trend.error} /> : points.length === 0 || points.every((p) => p.current === 0)
          ? <EmptyState title={t.dash.charts.noData} icon="show_chart" />
          : <TrendChart points={points} unit="count" title={t.dash.kpi.leads} />}
      </Card>
      <Card>
        <CardTitle>{s.funnel}</CardTitle>
        {funnel.error ? <ErrorState compact detail={funnel.error} /> : steps.length === 0 || steps[0].value === 0
          ? <EmptyState title={t.dash.common.empty} icon="filter_alt" compact />
          : <Funnel steps={steps} title={s.funnel} />}
      </Card>
    </div>
  );
}

async function ChannelsAndCampaigns({ f }: { f: DashFilters }) {
  const { t } = getI18n();
  const s = t.dash.sections;
  const tt = t.dash.table;
  const k = t.dash.kpi;
  const mf = mktFilters(f);
  const [channels, campaigns] = await Promise.all([getBreakdown("channel", mf), getBreakdown("campaign", mf)]);
  const cols = (first: string): Column[] => [
    { key: "name", label: first, primary: true },
    { key: "spend", label: tt.spend, kind: "money" },
    { key: "leads", label: tt.leads, kind: "number" },
    { key: "cpl", label: tt.cpl, kind: "money" },
    { key: "reservations", label: tt.reservations, kind: "number", hideOnMobile: true },
    { key: "sales", label: tt.sales, kind: "number" },
    { key: "revenue", label: k.mktRevenue, kind: "money", hideOnMobile: true },
    { key: "roas", label: k.roas, kind: "number", defaultHidden: true },
  ];
  const toRows = (data: typeof channels.data, href: (id: string) => string): Row[] =>
    (data ?? []).filter((r) => r.dim_key).map((r) => ({
      _id: r.dim_key!, _href: href(r.dim_key!), name: r.label,
      spend: Number(r.cost), leads: Number(r.leads), cpl: r.cpl === null ? null : Number(r.cpl),
      reservations: Number(r.reservations), sales: Number(r.sales), revenue: Number(r.commission),
      roas: r.roas === null ? null : Number(r.roas),
    }));
  return (
    <>
      <DashboardSection id="channels" title={s.channels} href="/dashboard/marketing/analytics" linkLabel={t.dash.common.details}>
        <Card>
          {channels.error ? <ErrorState compact detail={channels.error} /> : (
            <DataTable caption={s.channels} columns={cols(tt.channel)} rows={toRows(channels.data, (id) => `/dashboard/marketing/analytics?channel=${id}`)} pageSize={6} exportName="channels" initialSort={{ key: "leads", dir: "desc" }} />
          )}
        </Card>
      </DashboardSection>
      <DashboardSection id="campaigns" title={s.campaigns} href="/dashboard/marketing/campaigns" linkLabel={t.dash.common.viewAll}>
        <Card>
          {campaigns.error ? <ErrorState compact detail={campaigns.error} /> : (
            <DataTable caption={s.campaigns} columns={cols(tt.campaign)} rows={toRows(campaigns.data, (id) => `/dashboard/marketing/campaigns/${id}`)} pageSize={8} exportName="campaigns" initialSort={{ key: "leads", dir: "desc" }} />
          )}
        </Card>
      </DashboardSection>
    </>
  );
}

async function CrmSources({ f }: { f: DashFilters }) {
  const { t } = getI18n();
  const s = t.dash.sections;
  const [rows, labels] = await Promise.all([
    engineBy(["NEW_LEADS", "QUALIFIED_LEADS", "WON_DEALS"], "source", f.range, engineFilters(f), f.today),
    getDimLabels(),
  ]);
  if (!rows.ok) return <ErrorState compact detail={rows.error} />;
  const data = rows.data
    .map((r) => ({
      key: r.dims.source ?? "none",
      label: r.dims.source ? labels.source.get(r.dims.source) ?? t.dash.common.unknown : t.dash.common.unknown,
      value: num(r.metrics.NEW_LEADS) ?? 0,
      sub: `${t.dash.kpi.qualified}: ${num(r.metrics.QUALIFIED_LEADS) ?? 0} · ${t.dash.kpi.won}: ${num(r.metrics.WON_DEALS) ?? 0}`,
      href: r.dims.source ? drillHref("NEW_LEADS", { ...f, source: r.dims.source }) : undefined,
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  return (
    <DashboardSection id="sources" title={s.leadSources}>
      <Card>
        {data.length === 0 ? <EmptyState title={t.dash.common.empty} icon="campaign" compact /> : <BarList title={s.leadSources} unit="count" rows={data} limit={8} />}
      </Card>
    </DashboardSection>
  );
}

export default async function MarketingDashboard({ searchParams }: { searchParams: RawParams }) {
  const { t } = getI18n();
  const a = t.dash.actions;
  const [f, projects, canRead] = await Promise.all([readFilters(searchParams), getProjectOptions(), canReadMarketing()]);
  const actions: QuickAction[] = canRead
    ? [
        { href: "/dashboard/marketing/campaigns/new", label: a.newCampaign, icon: "add_circle" },
        { href: "/dashboard/marketing/executive", label: a.marketingHub, icon: "monitoring" },
        { href: "/dashboard/crm/overview", label: a.openCrm, icon: "groups" },
      ]
    : [];
  return (
    <DashMain>
      <DashboardHeader subtitle={fill(t.dash.subtitle.marketing, { range: rangeText(f) })} actions={actions} />
      <FilterBar
        preset={f.preset} from={f.range.from} to={f.range.to}
        project={f.project} team={null} source={null}
        projects={projects} compareLabel={compareText(f)}
        show={{ project: true }}
      />
      {canRead ? (
        <>
          <Slot fallback={<><KpiSkeleton size="lg" /><KpiSkeleton size="sm" /></>}><MarketingKpiRows f={f} /></Slot>
          <Slot fallback={<GridSkeleton cols={2} height="h-80" />}><MarketingTrendAndFunnel f={f} /></Slot>
          <Slot fallback={<SectionSkeleton height="h-80" />}><ChannelsAndCampaigns f={f} /></Slot>
        </>
      ) : (
        // بلا صلاحية التسويق: قلها صراحةً — لا أرقام فارغة كأنها أصفار
        <p role="note" className="mb-6 flex items-start gap-2 rounded-card border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          <Icon name="lock" />
          {t.dash.persona.noAccessMarketing}
        </p>
      )}
      <Slot fallback={<SectionSkeleton height="h-64" />}><CrmSources f={f} /></Slot>
    </DashMain>
  );
}
