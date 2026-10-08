import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { getDimLabels } from "@/lib/crm-reporting";
import { engineBy, getUnits } from "@/lib/dashboard/data";
import { engineFilters, reportHref, type DashFilters } from "@/lib/dashboard/period";
import { fmtMoney, fmtNumber, fmtPct } from "@/lib/dashboard/format";
import { num, rankProjects, sellThrough } from "@/lib/dashboard/kpi";
import { DashboardSection, EmptyState, StatusBadge } from "@/components/dashboard/ui";
import { Meter } from "@/components/dashboard/charts";
import { ErrorState } from "@/components/dashboard/states";

// ============================================================
// أداء المشاريع — بطاقة لكل مشروع:
//   المخزون من dashboard_units (182): متاحة/محجوزة/مباعة والتصريف
//   والمبيعات والليدات والتحويل للفترة من محرّك التقارير مجزّأً بالمشروع.
// «الأفضل» أعلى تصريفاً، و«يحتاج انتباهاً» أدناه وفيه مخزون متاح.
// النقر يفتح صفحة المشروع.
// ============================================================

export default async function ProjectsSection({ f }: { f: DashFilters }) {
  const { locale, t } = getI18n();
  const s = t.dash.sections;
  const tt = t.dash.table;
  const st = t.dash.status;
  const cur = t.dash.common.currency;
  const filters = engineFilters({ ...f, project: null });

  const [units, perf, labels] = await Promise.all([
    getUnits(f.project),
    engineBy(["REVENUE", "WON_DEALS", "RESERVATIONS", "NEW_LEADS", "CONVERSION_RATE"], "project", f.range, filters, f.today),
    getDimLabels(),
  ]);

  if (!units.ok) {
    return (
      <DashboardSection id="projects" title={s.projects} hint={s.projectsHint}>
        <ErrorState detail={units.error} />
      </DashboardSection>
    );
  }

  const byProject = new Map((perf.ok ? perf.data : []).map((r) => [r.dims.project ?? "", r.metrics]));
  const ids = new Set(units.data.map((u) => u.project_id ?? ""));
  // مشروعٌ له مبيعات أو ليدات ولا وحدات مسجّلة له يظهر أيضاً
  for (const id of Array.from(byProject.keys())) {
    if (id && !ids.has(id) && (!f.project || id === f.project)) ids.add(id);
  }

  const rows = Array.from(ids).map((id) => {
    const u = units.data.find((x) => (x.project_id ?? "") === id);
    const m = byProject.get(id) ?? {};
    const total = u?.total ?? 0;
    const sold = u?.sold ?? 0;
    return {
      id,
      name: u?.project_name ?? labels.project.get(id) ?? t.dash.common.unknown,
      total,
      available: u?.available ?? 0,
      // الحجز قد يظهر في حالة الوحدة أو في حجزٍ قائم أو فيهما معاً — لا نعدّه مرتين
      reserved: Math.max(u?.reserved ?? 0, u?.active_reservations ?? 0),
      sold,
      sellThrough: sellThrough(sold, total),
      revenue: num(m.REVENUE),
      won: num(m.WON_DEALS),
      leads: num(m.NEW_LEADS),
      conversion: num(m.CONVERSION_RATE),
    };
  }).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0) || b.total - a.total);

  const { top, attention } = rankProjects(rows);

  return (
    <DashboardSection id="projects" title={s.projects} hint={s.projectsHint} href={reportHref("project_performance", f)} linkLabel={t.dash.common.seeReport}>
      {rows.length === 0 ? (
        <div className="dash-card"><EmptyState title={t.dash.common.empty} icon="apartment" /></div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const body = (
              <>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h3 className="truncate text-sm font-bold text-ink">{r.name}</h3>
                  {top.has(r.id) && <StatusBadge tone="good" label={st.top} />}
                  {attention.has(r.id) && <StatusBadge tone="warning" label={st.needsAttention} />}
                </div>
                <div className="mb-1 flex items-baseline justify-between text-xs text-ink-secondary">
                  <span>{tt.sellThrough}</span>
                  <b className="text-sm text-ink">{fmtPct(r.sellThrough, locale)}</b>
                </div>
                <Meter value={r.sellThrough} label={`${r.name} — ${tt.sellThrough}`} />
                <dl className="num-tabular mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-surface-subtle py-1.5"><dt className="text-ink-muted">{tt.available}</dt><dd className="font-bold text-ink">{fmtNumber(r.available, locale)}</dd></div>
                  <div className="rounded-lg bg-surface-subtle py-1.5"><dt className="text-ink-muted">{tt.reserved}</dt><dd className="font-bold text-ink">{fmtNumber(r.reserved, locale)}</dd></div>
                  <div className="rounded-lg bg-surface-subtle py-1.5"><dt className="text-ink-muted">{tt.sold}</dt><dd className="font-bold text-ink">{fmtNumber(r.sold, locale)}</dd></div>
                </dl>
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
                  <div><dt className="text-ink-muted">{tt.revenue}</dt><dd className="font-bold text-ink">{fmtMoney(r.revenue, locale, cur)}</dd></div>
                  <div><dt className="text-ink-muted">{tt.leads}</dt><dd className="font-bold text-ink">{fmtNumber(r.leads, locale)}</dd></div>
                  <div><dt className="text-ink-muted">{tt.conversion}</dt><dd className="font-bold text-ink">{fmtPct(r.conversion, locale)}</dd></div>
                </dl>
              </>
            );
            return (
              <li key={r.id || "none"}>
                {r.id ? (
                  <Link href={`/dashboard/projects/${r.id}`} className="dash-card-link block h-full p-4">{body}</Link>
                ) : (
                  <div className="dash-card h-full p-4">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </DashboardSection>
  );
}
