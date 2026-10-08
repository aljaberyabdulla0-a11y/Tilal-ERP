import { getI18n } from "@/lib/i18n/server";
import { getBreakdown, getKpisFor, type Kpis } from "@/lib/marketing";
import type { MktFilters } from "@/lib/marketing-filters";
import type { DashFilters } from "@/lib/dashboard/period";
import { fmtMoney } from "@/lib/dashboard/format";
import { makeKpi, num, type Kpi } from "@/lib/dashboard/kpi";
import { Card, CardTitle, DashboardSection, EmptyState, KpiGrid } from "@/components/dashboard/ui";
import { BarList } from "@/components/dashboard/charts";

// ============================================================
// أداء التسويق — من وحدة التسويق (125) لا من حساب جديد:
//   mkt_kpis للفترتين (الإنفاق، الليدات، كلفة الليد، العائد)،
//   و mkt_breakdown للقنوات. العائد على عمولة تلال لا قيمة الوحدات.
//
// ⚠️ أرقام المال فيها تُحجب داخل الدوال عمّن لا يملك صلاحيتها
//    (can_read_marketing_money) — فتظهر «—» لا صفراً.
// ============================================================

export function mktFilters(f: DashFilters): MktFilters {
  return {
    preset: "custom", from: f.range.from, to: f.range.to,
    project: f.project, campaign: null, channel: null, model: "last", params: {},
  };
}

export function marketingKpis(cur: Kpis | null, prev: Kpis | null, k: ReturnType<typeof getI18n>["t"]["dash"]["kpi"]): Kpi[] {
  const p = (v: unknown) => (prev ? num(v) : undefined);
  return [
    makeKpi({ key: "spend", title: k.spend, value: num(cur?.cost), unit: "money", direction: "neutral", icon: "payments", href: "/dashboard/marketing/expenses" }, p(prev?.cost)),
    makeKpi({ key: "leads", title: k.leads, value: num(cur?.leads), unit: "count", direction: "positive", icon: "person_add", href: "/dashboard/marketing/analytics" }, p(prev?.leads)),
    makeKpi({ key: "cpl", title: k.cpl, value: num(cur?.cpl), unit: "money", direction: "negative", icon: "price_check", href: "/dashboard/marketing/analytics" }, p(prev?.cpl)),
    makeKpi({ key: "roas", title: k.roas, value: num(cur?.roas), unit: "ratio", direction: "positive", icon: "trending_up", href: "/dashboard/marketing/executive" }, p(prev?.roas)),
  ];
}

export default async function MarketingSection({ f }: { f: DashFilters }) {
  const { locale, t } = getI18n();
  const s = t.dash.sections;
  const mf = mktFilters(f);
  const [cur, prev, channels] = await Promise.all([
    getKpisFor({ from: f.range.from, to: f.range.to }, mf),
    f.previous ? getKpisFor(f.previous, mf) : Promise.resolve(null),
    getBreakdown("channel", mf),
  ]);

  const rows = (channels.data ?? [])
    .filter((r) => Number(r.leads) > 0 || Number(r.cost) > 0)
    .sort((a, b) => Number(b.leads) - Number(a.leads));

  return (
    <DashboardSection id="marketing" title={s.marketing} hint={s.marketingHint} href="/dashboard/marketing/executive" linkLabel={t.dash.common.seeReport}>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <KpiGrid kpis={marketingKpis(cur, prev, t.dash.kpi)} size="sm" cols={4} label={s.marketing} />
        </div>
        <Card className="lg:col-span-2">
          <CardTitle href="/dashboard/marketing/analytics" linkLabel={t.dash.common.details}>{s.channels}</CardTitle>
          {rows.length === 0 ? (
            <EmptyState title={t.dash.common.empty} icon="campaign" compact />
          ) : (
            <BarList
              title={s.channels}
              unit="count"
              limit={5}
              rows={rows.map((r) => ({
                key: r.dim_key ?? r.label,
                label: r.label,
                value: Number(r.leads),
                sub: r.cpl !== null ? `${t.dash.kpi.cpl}: ${fmtMoney(Number(r.cpl), locale, t.dash.common.currency)}` : undefined,
              }))}
            />
          )}
        </Card>
      </div>
    </DashboardSection>
  );
}
