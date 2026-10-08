import { getI18n } from "@/lib/i18n/server";
import { getAttention, getBrokerPerformance } from "@/lib/dashboard/data";
import { rangeHref, type DashFilters } from "@/lib/dashboard/period";
import { Card, CardTitle, DashboardSection, EmptyState, StatTile } from "@/components/dashboard/ui";
import DataTable, { type Column, type Row } from "@/components/dashboard/data-table";
import { ErrorState } from "@/components/dashboard/states";

// ============================================================
// أداء الوساطة — broker_performance (130): لكل شركة ليداتها وطلباتها
// وحجوزاتها ومبيعاتها وعمولتها في الفترة، بنطاق المستدعي
// (my_scope_broker_companies). والطلبات المفتوحة من dashboard_attention.
// المجاميع تُجمع من صفوف الشركات (عشرات لا آلاف).
// ============================================================

export default async function BrokerageSection({ f }: { f: DashFilters }) {
  const { t } = getI18n();
  const s = t.dash.sections;
  const k = t.dash.kpi;
  const tt = t.dash.table;
  const [perf, att] = await Promise.all([getBrokerPerformance(f.range, f.project), getAttention(f.project)]);

  if (!perf.ok) {
    return (
      <DashboardSection id="brokerage" title={s.brokerage} hint={s.brokerageHint}>
        <ErrorState detail={perf.error} />
      </DashboardSection>
    );
  }
  const rows = perf.data;
  const sum = (key: "sales" | "sales_value" | "commission") => rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

  const cols: Column[] = [
    { key: "name", label: tt.company, primary: true },
    { key: "leads", label: tt.leads, kind: "number" },
    { key: "requests", label: t.dash.kpi.openRequests, kind: "number", hideOnMobile: true },
    { key: "reservations", label: tt.reservations, kind: "number" },
    { key: "sales", label: tt.sales, kind: "number" },
    { key: "conversion", label: tt.conversion, kind: "pct", hideOnMobile: true },
    { key: "value", label: tt.salesValue, kind: "money" },
    { key: "commission", label: tt.commission, kind: "money", defaultHidden: true },
  ];
  const tableRows: Row[] = rows.map((r) => ({
    _id: r.company_id,
    _href: `/dashboard/brokers/${r.company_id}`,
    name: r.company_name,
    leads: Number(r.leads),
    requests: Number(r.requests),
    reservations: Number(r.reservations),
    sales: Number(r.sales),
    conversion: r.conversion_rate === null ? null : Number(r.conversion_rate),
    value: Number(r.sales_value),
    commission: Number(r.commission),
  }));

  return (
    <DashboardSection id="brokerage" title={s.brokerage} hint={s.brokerageHint} href={rangeHref("/dashboard/brokers/performance", f)} linkLabel={t.dash.common.seeReport}>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label={k.brokerSales} value={sum("sales")} href={rangeHref("/dashboard/brokers/performance", f)} />
        <StatTile label={k.brokerValue} value={sum("sales_value")} unit="money" href={rangeHref("/dashboard/brokers/performance", f)} />
        <StatTile label={k.brokerCommission} value={sum("commission")} unit="money" href="/dashboard/brokers/commissions" />
        <StatTile
          label={k.openRequests}
          value={att.ok ? Number(att.data.broker_requests_open) : null}
          tone={att.ok && Number(att.data.broker_requests_open) > 0 ? "warning" : "neutral"}
          href="/dashboard/brokers/requests"
        />
      </div>
      <Card>
        <CardTitle>{tt.company}</CardTitle>
        {tableRows.length === 0 ? (
          <EmptyState title={t.dash.common.empty} icon="handshake" compact />
        ) : (
          <DataTable caption={s.brokerage} columns={cols} rows={tableRows} pageSize={5} exportName="brokers" initialSort={{ key: "sales", dir: "desc" }} />
        )}
      </Card>
    </DashboardSection>
  );
}
