import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { tValue } from "@/lib/i18n/values";
import { getFunnel, getVelocity } from "@/lib/crm";
import { engineSeries, engineTotals } from "@/lib/dashboard/data";
import { dashQuery, drillHref, engineFilters, reportHref, toSearch, type DashFilters, type Grain } from "@/lib/dashboard/period";
import { fmtBucket } from "@/lib/dashboard/format";
import { num } from "@/lib/dashboard/kpi";
import { Card, CardTitle, DashboardSection, EmptyState, StatTile } from "@/components/dashboard/ui";
import { Funnel, TrendChart, type TrendPoint } from "@/components/dashboard/charts";
import { ErrorState } from "@/components/dashboard/states";

// ============================================================
// أداء المبيعات:
//   • الاتجاه: قيمة الفوز (REVENUE) يومياً/أسبوعياً/شهرياً، والفترة
//     السابقة فوقها خطّاً متقطّعاً — مربوطتين بالموضع (اليوم الثالث
//     مقابل الثالث).
//   • القِمع الحقيقي من crm_funnel (076): كم فرصةً **بلغت** كل مرحلة.
//     لا «عملاء ← حجوزات ← وحدات» كما كان — تلك كيانات مختلفة لا
//     مراحل قِمع واحد (H4).
//   • سرعة البيع من crm_sales_velocity.
// ============================================================

export default async function SalesSection({ f, path = "/dashboard" }: { f: DashFilters; path?: string }) {
  const { locale, t } = getI18n();
  const s = t.dash.sections;
  const k = t.dash.kpi;
  const filters = engineFilters(f);

  const [series, prevSeries, totals, funnel, velocity] = await Promise.all([
    engineSeries(["REVENUE"], f.range, filters, f.grain, f.today, f.weekStartDow),
    f.previous ? engineSeries(["REVENUE"], f.previous, filters, f.grain, f.today, f.weekStartDow) : Promise.resolve(null),
    engineTotals(["SALES_COMPLETED", "WON_DEALS", "AVG_DEAL_VALUE", "RESERVATIONS"], f.range, filters, f.today),
    getFunnel({ from: f.range.from, to: f.range.to, projectId: f.project, sourceId: f.source }),
    getVelocity({ from: f.range.from, to: f.range.to }),
  ]);

  const grains: Grain[] = ["day", "week", "month"];
  const grainLinks = (
    <div role="group" aria-label={s.trend} className="flex rounded-lg bg-surface-sunken p-0.5 text-xs">
      {grains.map((g) => (
        <Link
          key={g}
          href={`${path}${toSearch(dashQuery(f, { grain: g }))}`}
          scroll={false}
          aria-current={f.grain === g ? "true" : undefined}
          className={`dash-focus rounded-md px-2.5 py-1 font-semibold ${f.grain === g ? "bg-surface text-brand-700 shadow-card" : "text-ink-secondary hover:text-ink"}`}
        >
          {t.dash.charts.grain[g]}
        </Link>
      ))}
    </div>
  );

  let trend: React.ReactNode;
  if (!series.ok) trend = <ErrorState compact detail={series.error} />;
  else {
    const prevVals = prevSeries && prevSeries.ok ? prevSeries.data : [];
    const points: TrendPoint[] = series.data.map((b, i) => ({
      key: b.key,
      label: fmtBucket(b.key, f.grain, locale),
      current: num(b.metrics.REVENUE) ?? 0,
      previous: prevVals[i] ? num(prevVals[i].metrics.REVENUE) ?? 0 : null,
    }));
    trend = points.every((p) => p.current === 0 && !p.previous)
      ? <EmptyState title={t.dash.charts.noData} hint={t.dash.common.emptyHint} icon="show_chart" />
      : <TrendChart points={points} unit="money" title={s.sales} />;
  }

  const tot = totals.ok ? totals.data : null;
  const steps = funnel
    .slice()
    .sort((a, b) => a.stage_order - b.stage_order)
    .map((st) => ({
      key: String(st.stage_order),
      label: tValue(st.stage_name, locale),
      value: Number(st.reached),
      conversion: st.step_conversion === null ? null : Number(st.step_conversion),
    }));

  return (
    <DashboardSection id="sales" title={s.sales} hint={s.salesHint} href={reportHref("daily_sales_performance", f)} linkLabel={t.dash.common.seeReport}>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">{k.sales}</h3>
            {grainLinks}
          </div>
          {trend}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label={k.wonDeals} value={tot ? num(tot.WON_DEALS) : null} href={drillHref("WON_DEALS", f)} />
            <StatTile label={k.salesCompleted} value={tot ? num(tot.SALES_COMPLETED) : null} href={drillHref("SALES_COMPLETED", f)} hint={k.salesCompletedDef} />
            <StatTile label={k.avgDeal} value={tot ? num(tot.AVG_DEAL_VALUE) : null} unit="money" href={drillHref("AVG_DEAL_VALUE", f)} />
            <StatTile label={k.salesCycle} value={velocity ? Number(velocity.avg_cycle_days) : null} unit="days" hint={k.salesCycleDef} />
          </div>
        </Card>
        <Card>
          <CardTitle href="/dashboard/crm/reports/analysis" linkLabel={t.dash.common.details}>{s.funnel}</CardTitle>
          <p className="-mt-2 mb-3 text-[11px] text-ink-muted">{s.funnelHint}</p>
          {steps.length === 0 || steps[0].value === 0
            ? <EmptyState title={t.dash.common.empty} icon="filter_alt" compact />
            : <Funnel steps={steps} title={s.funnel} />}
        </Card>
      </div>
    </DashboardSection>
  );
}
