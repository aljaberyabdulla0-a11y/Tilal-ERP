import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { getDistributionAlerts, getOwnerLoad, getSlaSummary, getUnworkedLeads, SEVERITY_STYLE } from "@/lib/crm";
import { getAttention } from "@/lib/dashboard/data";
import { fill } from "@/lib/dashboard/format";
import { AttentionPanel, type AlertItem } from "@/components/dashboard/attention-panel";
import { ErrorState } from "@/components/dashboard/states";

// ============================================================
// «يحتاج انتباهك» — يجمع مصدرين:
//   • تنبيهات الـCRM من دوالّها (073/075): التوزيع والـSLA والصامتون
//   • العدّادات التشغيلية من dashboard_attention (182)
//
// كل دور يطلب ما يتصرّف فيه (include) — والقاعدة تُرجع لكلٍّ ما يراه
// أصلاً، فما لا يخصّه يرجع صفراً ولا يُعرض.
// ============================================================

export type AttentionKey =
  | "unworked" | "sla" | "overCapacity" | "silentOwners"
  | "saleRequests" | "reservationsExpiring" | "reservationsExpired"
  | "brokerRequests" | "brokerSupervisor" | "brokerLeads"
  | "approvals" | "leaves" | "inventory" | "tasks";

export const ATTENTION_BY_ROLE: Record<"admin" | "supervisor" | "followup", AttentionKey[]> = {
  admin: [
    "sla", "unworked", "overCapacity", "silentOwners", "saleRequests", "reservationsExpired",
    "reservationsExpiring", "brokerRequests", "brokerLeads", "approvals", "leaves", "inventory", "tasks",
  ],
  supervisor: [
    "sla", "unworked", "overCapacity", "silentOwners", "reservationsExpired", "reservationsExpiring",
    "brokerSupervisor", "brokerLeads", "approvals", "tasks",
  ],
  // المخزون والمهام لهما بطاقتان في رأس لوحته — لا تكرار هنا
  followup: ["sla", "unworked", "overCapacity", "silentOwners", "approvals", "leaves"],
};

const WEEK_MS = 7 * 86400000;

export default async function AttentionSection({
  projectId, include, showCrmDetail = true,
}: { projectId: string | null; include: AttentionKey[]; showCrmDetail?: boolean }) {
  const { t } = getI18n();
  const a = t.dash.attention;
  const it = a.items;
  const want = new Set(include);
  const crmWanted = ["unworked", "sla", "overCapacity", "silentOwners"].some((k) => want.has(k as AttentionKey));

  const [att, alerts, load, unworked, sla] = await Promise.all([
    getAttention(projectId),
    crmWanted ? getDistributionAlerts() : Promise.resolve([]),
    crmWanted ? getOwnerLoad() : Promise.resolve([]),
    crmWanted ? getUnworkedLeads() : Promise.resolve([]),
    crmWanted ? getSlaSummary() : Promise.resolve([]),
  ]);

  // الـCRM يبتلع أخطاءه ويُرجع فراغاً (crm.ts)؛ أمّا العدّادات فإن فشلت
  // قلنا ذلك ولم نعرض «لا شيء عاجل» كأنه حقيقة.
  if (!att.ok && !crmWanted) return <ErrorState compact detail={att.error} />;

  const openBreaches = sla.reduce((s, r) => s + Number(r.still_open), 0);
  const overloaded = load.filter((o) => o.over_capacity).length;
  const now = Date.now();
  const silent = load.filter(
    (o) => Number(o.open_leads) > 0 && (!o.last_activity || now - new Date(o.last_activity).getTime() > WEEK_MS)
  ).length;
  const oldest = [...unworked].sort((x, y) => Number(y.days_since_assignment) - Number(x.days_since_assignment));
  const oldestDays = oldest[0] ? Math.round(Number(oldest[0].days_since_assignment)) : 0;
  const c = att.ok ? att.data : null;
  const n = (v: unknown) => Number(v ?? 0);

  const all: (AlertItem & { k: AttentionKey })[] = [
    { k: "sla", key: "sla", severity: "critical", icon: "timer_off", count: openBreaches, ...it.sla, description: it.sla.desc, href: "/dashboard/crm/reports/analysis#sla" },
    { k: "unworked", key: "unworked", severity: "high", icon: "person_off", count: unworked.length, ...it.unworked, description: fill(it.unworked.desc, { days: oldestDays }), href: "/dashboard/crm/distribution" },
    { k: "overCapacity", key: "overCapacity", severity: "medium", icon: "group_work", count: overloaded, ...it.overCapacity, description: it.overCapacity.desc, href: "/dashboard/crm/distribution" },
    { k: "silentOwners", key: "silentOwners", severity: "medium", icon: "notifications_paused", count: silent, ...it.silentOwners, description: it.silentOwners.desc, href: "/dashboard/crm/distribution" },
    { k: "saleRequests", key: "saleRequests", severity: "high", icon: "gavel", count: n(c?.sale_requests_pending), ...it.saleRequests, description: it.saleRequests.desc, href: "/dashboard/reservations" },
    { k: "reservationsExpired", key: "reservationsExpired", severity: "high", icon: "event_busy", count: n(c?.reservations_expired), ...it.reservationsExpired, description: it.reservationsExpired.desc, href: "/dashboard/reservations" },
    { k: "reservationsExpiring", key: "reservationsExpiring", severity: "medium", icon: "event_upcoming", count: n(c?.reservations_expiring), ...it.reservationsExpiring, description: it.reservationsExpiring.desc, href: "/dashboard/reservations" },
    { k: "brokerSupervisor", key: "brokerSupervisor", severity: "high", icon: "how_to_reg", count: n(c?.broker_requests_supervisor), ...it.brokerSupervisor, description: it.brokerSupervisor.desc, href: "/dashboard/brokers/requests" },
    { k: "brokerRequests", key: "brokerRequests", severity: "medium", icon: "real_estate_agent", count: n(c?.broker_requests_open), ...it.brokerRequests, description: it.brokerRequests.desc, href: "/dashboard/brokers/requests" },
    { k: "brokerLeads", key: "brokerLeads", severity: "medium", icon: "hourglass_bottom", count: n(c?.broker_leads_expiring), ...it.brokerLeads, description: it.brokerLeads.desc, href: "/dashboard/brokers/leads" },
    { k: "approvals", key: "approvals", severity: "high", icon: "approval", count: n(c?.approvals_pending), ...it.approvals, description: it.approvals.desc, href: "/dashboard/me/approvals" },
    { k: "leaves", key: "leaves", severity: "low", icon: "beach_access", count: n(c?.leaves_pending), ...it.leaves, description: it.leaves.desc, href: "/dashboard/hr/leaves" },
    { k: "inventory", key: "inventory", severity: "medium", icon: "inventory", count: n(c?.inventory_low), ...it.inventory, description: it.inventory.desc, href: "/dashboard/inventory?state=low" },
    { k: "tasks", key: "tasks", severity: "medium", icon: "assignment_late", count: n(c?.tasks_overdue), ...it.tasks, description: it.tasks.desc, href: "/dashboard/tasks" },
  ];
  const items = all.filter((x) => want.has(x.k));
  const topAlerts = showCrmDetail ? alerts.slice(0, 3) : [];
  const topOldest = showCrmDetail ? oldest.slice(0, 5) : [];

  return (
    <AttentionPanel items={items} title={t.dash.sections.attention} hint={t.dash.sections.attentionHint}>
      {(topAlerts.length > 0 || topOldest.length > 0) && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {topAlerts.length > 0 && (
            <div className="dash-card p-4">
              <h3 className="mb-2 text-sm font-bold text-ink">{a.alertsTitle}</h3>
              <ul className="space-y-2">
                {topAlerts.map((al, i) => (
                  <li key={`${al.code}-${i}`} className={`rounded-lg border p-2.5 text-xs ${SEVERITY_STYLE[al.severity]}`}>
                    <b>{al.title}:</b> {al.detail}
                    <span className="mt-1 block opacity-80">↳ {al.recommendation}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {topOldest.length > 0 && (
            <div className="dash-card p-4">
              <h3 className="mb-2 text-sm font-bold text-ink">{a.oldest}</h3>
              <ul className="divide-y divide-line text-sm">
                {topOldest.map((u) => (
                  <li key={u.client_id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`/dashboard/clients/${u.client_id}`} className="dash-focus truncate rounded font-medium text-brand-700 hover:underline">
                      {u.client_name}
                    </Link>
                    <span className="shrink-0 text-xs text-ink-muted">
                      {u.owner_name ?? a.noOwner} · {fill(a.sinceDays, { n: Math.round(Number(u.days_since_assignment)) })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </AttentionPanel>
  );
}
