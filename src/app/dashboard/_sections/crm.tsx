import { getI18n } from "@/lib/i18n/server";
import { getCrmKpis, getTeamPerformance } from "@/lib/crm";
import { getDimLabels } from "@/lib/crm-reporting";
import { engineBy } from "@/lib/dashboard/data";
import { drillHref, engineFilters, reportHref, type DashFilters } from "@/lib/dashboard/period";
import { num } from "@/lib/dashboard/kpi";
import { Card, CardTitle, DashboardSection, EmptyState, StatTile } from "@/components/dashboard/ui";
import { BarList } from "@/components/dashboard/charts";
import DataTable, { type Column, type Row } from "@/components/dashboard/data-table";
import { ErrorState } from "@/components/dashboard/states";

// ============================================================
// أداء الـCRM:
//   • crm_kpis (076←083←095) — يحترم نطاق المشرف تلقائياً
//   • المصادر وأسباب الخسارة: محرّك التقارير مجزّأً (source / lost_reason)
//   • أداء المسؤولين: crm_team_performance (095)
// كل رقم يفتح قائمته: الساخنة، المتأخرة، المفتوحة، الخاسرة…
// ============================================================

const HOT = encodeURIComponent("ساخن");

export default async function CrmSection({ f, showOwners = true }: { f: DashFilters; showOwners?: boolean }) {
  const { t } = getI18n();
  const s = t.dash.sections;
  const k = t.dash.kpi;
  const tt = t.dash.table;
  const filters = engineFilters(f);

  const [kpis, bySource, byLost, team, labels] = await Promise.all([
    getCrmKpis({ from: f.range.from, to: f.range.to, projectId: f.project, teamId: f.team, sourceId: f.source }),
    engineBy(["NEW_LEADS", "WON_DEALS"], "source", f.range, filters, f.today),
    engineBy(["LOST_DEALS"], "lost_reason", f.range, filters, f.today),
    showOwners ? getTeamPerformance({ from: f.range.from, to: f.range.to, teamId: f.team ?? f.project }) : Promise.resolve([]),
    getDimLabels(),
  ]);

  const unknown = t.dash.common.unknown;
  const sources = bySource.ok
    ? bySource.data
        .map((r) => ({
          key: r.dims.source ?? "none",
          label: r.dims.source ? labels.source.get(r.dims.source) ?? unknown : unknown,
          value: num(r.metrics.NEW_LEADS) ?? 0,
          won: num(r.metrics.WON_DEALS) ?? 0,
        }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
    : null;
  const lost = byLost.ok
    ? byLost.data
        .map((r) => ({
          key: r.dims.lost_reason ?? "none",
          label: r.dims.lost_reason ? labels.lost_reason.get(r.dims.lost_reason) ?? unknown : unknown,
          value: num(r.metrics.LOST_DEALS) ?? 0,
        }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
    : null;

  const cols: Column[] = [
    { key: "name", label: tt.employee, primary: true },
    { key: "leads", label: tt.leads, kind: "number" },
    { key: "worked", label: tt.worked, kind: "number", hideOnMobile: true },
    { key: "won", label: tt.won, kind: "number" },
    { key: "conversion", label: tt.conversion, kind: "pct" },
    { key: "activities", label: tt.activities, kind: "number", hideOnMobile: true },
    { key: "overdue", label: tt.overdue, kind: "number" },
    { key: "wonValue", label: tt.wonValue, kind: "money", defaultHidden: true },
  ];
  const rows: Row[] = team.map((r) => ({
    _id: r.owner_id,
    _href: `/dashboard/clients?owner=${r.owner_id}`,
    name: r.owner_name,
    leads: Number(r.leads_received),
    worked: Number(r.leads_worked),
    won: Number(r.won),
    conversion: Number(r.conversion_rate),
    activities: Number(r.activities),
    overdue: Number(r.overdue),
    wonValue: Number(r.won_value),
  }));

  return (
    <DashboardSection id="crm" title={s.crm} hint={s.crmHint} href="/dashboard/crm/reports" linkLabel={t.dash.common.seeReport}>
      {kpis ? (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <StatTile label={k.open} value={num(kpis.open_count)} href="/dashboard/crm/opportunities?type=open&view=list" />
          <StatTile label={k.won} value={num(kpis.won_count)} tone="good" href="/dashboard/crm/opportunities?type=won&view=list" />
          <StatTile label={k.lost} value={num(kpis.lost_count)} href="/dashboard/crm/lost" />
          <StatTile label={k.pipeline} value={num(kpis.pipeline_value)} unit="money" href="/dashboard/crm/opportunities?type=open" hint={k.pipelineDef} />
          <StatTile label={k.weightedPipeline} value={num(kpis.weighted_pipeline)} unit="money" href="/dashboard/crm/forecast" hint={k.weightedPipelineDef} />
          <StatTile label={k.hotLeads} value={num(kpis.hot_count)} tone={Number(kpis.hot_count) > 0 ? "good" : "neutral"} href={`/dashboard/clients?temperature=${HOT}`} />
          <StatTile label={k.overdue} value={num(kpis.overdue_count)} tone={Number(kpis.overdue_count) > 0 ? "warning" : "neutral"} href="/dashboard/clients?followup=overdue" />
          <StatTile label={k.stale} value={num(kpis.neglected_count)} tone={Number(kpis.neglected_count) > 0 ? "danger" : "neutral"} href={drillHref("NEGLECTED", f)} />
        </div>
      ) : (
        <div className="mb-4"><ErrorState compact /></div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle href={reportHref("marketing_source", f)} linkLabel={t.dash.common.details}>{s.leadSources}</CardTitle>
          {sources === null ? <ErrorState compact /> : sources.length === 0 ? (
            <EmptyState title={t.dash.common.empty} hint={t.dash.common.emptyHint} icon="campaign" compact />
          ) : (
            <BarList
              title={s.leadSources}
              unit="count"
              rows={sources.map((r) => ({ key: r.key, label: r.label, value: r.value, sub: `${k.won}: ${r.won}`, href: drillHref("NEW_LEADS", { ...f, source: r.key === "none" ? f.source : r.key }) }))}
            />
          )}
        </Card>
        <Card>
          <CardTitle href={`/dashboard/crm/lost`} linkLabel={t.dash.common.details}>{s.lostReasons}</CardTitle>
          {lost === null ? <ErrorState compact /> : lost.length === 0 ? (
            <EmptyState title={t.dash.common.empty} icon="sentiment_satisfied" compact />
          ) : (
            <BarList title={s.lostReasons} unit="count" color="var(--viz-2)" rows={lost.map((r) => ({ key: r.key, label: r.label, value: r.value, href: "/dashboard/crm/lost" }))} />
          )}
        </Card>
      </div>

      {showOwners && rows.length > 0 && (
        <Card className="mt-4">
          <CardTitle href={reportHref("salesperson_productivity", f)} linkLabel={t.dash.common.seeReport}>{s.ownerPerformance}</CardTitle>
          <DataTable caption={s.ownerPerformance} columns={cols} rows={rows} exportName="owner-performance" initialSort={{ key: "won", dir: "desc" }} />
        </Card>
      )}
    </DashboardSection>
  );
}
