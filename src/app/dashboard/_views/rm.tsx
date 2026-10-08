import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { tValue } from "@/lib/i18n/values";
import {
  bucketLeads, companyMoney, getBrokerCommissions, getBrokerCompanies, getBrokerLeads,
  getBrokerPayments, getBrokerProjects, getBrokerRequests, paidByCommission,
} from "@/lib/brokers";
import { isOpenBrokerRequest, leadDaysLeft, type BrokerCommission, type Client } from "@/lib/types";
import { fill, fmtRelative, fmtShortDate } from "@/lib/dashboard/format";
import { countStatus, type Kpi } from "@/lib/dashboard/kpi";
import { DashboardHeader, type QuickAction } from "@/components/dashboard/page-header";
import { Slot } from "@/components/dashboard/slot";
import { SectionSkeleton } from "@/components/dashboard/skeleton";
import { Card, CardTitle, DashboardSection, EmptyState, Icon, KpiGrid, StatusBadge } from "@/components/dashboard/ui";
import DataTable, { type Column, type Row } from "@/components/dashboard/data-table";
import TodayTasks from "@/components/today-tasks";
import { getEmployeeName } from "./names";
import { DashMain } from "./shared";

// ============================================================
// لوحة مدير العلاقات (RM).
//
// نطاقه تفرضه القاعدة (043، 128): الشركات المُسنَدة إليه في مشاريعه —
// فلا شرط هنا. وما يهمّه أولاً: ليد يوشك أن يضيع من شركةٍ تحت مظلته،
// ثم شركة صامتة لا تتواصل مع ليداتها.
//
// تجميع الشركات صار مروراً واحداً على الليدات (Map) بدل تصفيتها كلها
// لكل شركة (O(شركات × ليدات)). ⚠️ ما زال يجلب ليدات نطاقه كلها — مقبول
// لنطاق RM اليوم، ومرشّحٌ لدالّة تجميع في القاعدة إن كبر (انظر التوثيق).
// ============================================================

async function RmBody() {
  const { locale, t } = getI18n();
  const k = t.dash.kpi;
  const s = t.dash.sections;
  const tt = t.dash.table;
  const st = t.dash.status;
  const [companies, links, leads, commissions, payments, requests] = await Promise.all([
    getBrokerCompanies(), getBrokerProjects(), getBrokerLeads(), getBrokerCommissions(), getBrokerPayments(), getBrokerRequests(),
  ]);

  const openRequests = requests.filter((r) => isOpenBrokerRequest(r.status)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const buckets = bucketLeads(leads);
  const urgent = [...buckets.expired, ...buckets.urgent];
  const silent = leads.filter((l) => !l.last_contact_at && l.stage !== "بيع");
  const paid = paidByCommission(payments);

  const leadsBy = new Map<string, Client[]>();
  for (const l of leads) {
    const id = l.broker_company_id ?? "";
    const arr = leadsBy.get(id);
    if (arr) arr.push(l); else leadsBy.set(id, [l]);
  }
  const commBy = new Map<string, BrokerCommission[]>();
  for (const c of commissions) {
    const arr = commBy.get(c.company_id);
    if (arr) arr.push(c); else commBy.set(c.company_id, [c]);
  }

  const rows: Row[] = companies.map((c) => {
    const mine = leadsBy.get(c.id) ?? [];
    const b = bucketLeads(mine);
    const critical = b.expired.length + b.urgent.length;
    const noContact = mine.filter((l) => !l.last_contact_at && l.stage !== "بيع").length;
    const [tone, label] = critical > 0 ? ["danger", st.critical] : noContact > 0 ? ["warning", st.warning] : ["good", st.onTrack];
    return {
      _id: c.id, _href: `/dashboard/brokers/${c.id}`, name: c.name,
      active: b.active.length + b.urgent.length + b.expired.length,
      critical, noContact,
      deals: companyMoney(commBy.get(c.id) ?? [], paid).deals,
      status: label, tone,
    };
  });

  const projectNames = Array.from(new Set(links.map((l) => l.projects?.name).filter(Boolean))) as string[];

  const kpis: Kpi[] = [
    { key: "co", title: k.companiesCount, value: companies.length, unit: "count", direction: "neutral", icon: "apartment", delta: null, href: "/dashboard/brokers" },
    { key: "req", title: k.requestsWaiting, value: openRequests.length, unit: "count", direction: "negative", icon: "event_available", delta: null, href: "/dashboard/brokers/requests", status: openRequests.length ? "warning" : "good" },
    { key: "crit", title: k.criticalDeadlines, value: urgent.length, unit: "count", direction: "negative", icon: "hourglass_bottom", delta: null, href: "/dashboard/brokers/leads", status: countStatus(urgent.length) },
    { key: "silent", title: k.noContact, value: silent.length, unit: "count", direction: "negative", icon: "phone_missed", delta: null, href: "/dashboard/brokers/leads", status: silent.length ? "warning" : "good" },
    { key: "closed", title: k.closedDeals, value: buckets.closed.length, unit: "count", direction: "positive", icon: "handshake", delta: null, href: "/dashboard/brokers/commissions" },
  ];

  const cols: Column[] = [
    { key: "name", label: tt.company, primary: true },
    { key: "active", label: tt.leads, kind: "number" },
    { key: "critical", label: tt.criticalLeads, kind: "number" },
    { key: "noContact", label: tt.noContact, kind: "number" },
    { key: "deals", label: tt.deals, kind: "number" },
    { key: "status", label: tt.status, kind: "badge", toneKey: "tone" },
  ];

  return (
    <>
      <p className="-mt-3 mb-5 text-sm text-ink-secondary">
        {projectNames.length > 0 ? fill(t.dash.subtitle.rm, { projects: projectNames.join(" · ") }) : t.dash.subtitle.rmNone}
      </p>
      <div className="mb-6"><KpiGrid kpis={kpis} size="md" cols={5} label={s.primary} /></div>

      {openRequests.length > 0 && (
        <DashboardSection id="requests" title={s.requests} href="/dashboard/brokers/requests" linkLabel={t.dash.common.viewAll}>
          <Card>
            <ul className="divide-y divide-line">
              {openRequests.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <Link href={`/dashboard/brokers/requests/${r.id}`} className="dash-focus flex flex-wrap items-center justify-between gap-2 rounded px-1 py-2.5 hover:bg-surface-subtle">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{fill(t.dash.broker.unitLabel, { code: r.unit_code ?? "—" })}</span>
                      <span className="text-xs text-ink-muted">{[r.broker_companies?.name, r.clients?.name, fmtRelative(r.created_at, locale)].filter(Boolean).join(" · ")}</span>
                    </span>
                    <StatusBadge tone={r.status === "بحاجة لمعلومات" ? "warning" : "info"} label={tValue(r.status, locale)} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </DashboardSection>
      )}

      <DashboardSection id="companies" title={s.companies} href="/dashboard/brokers" linkLabel={t.dash.common.details}>
        <Card>
          {rows.length === 0 ? <EmptyState title={t.dash.rm.noCompanies} icon="apartment" compact /> : (
            <DataTable caption={s.companies} columns={cols} rows={rows} exportName="companies" initialSort={{ key: "critical", dir: "desc" }} />
          )}
        </Card>
      </DashboardSection>

      <DashboardSection id="returning" title={s.returning}>
        <Card>
          {urgent.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-success-700"><Icon name="check_circle" />{t.dash.rm.noReturning}</p>
          ) : (
            <ul className="divide-y divide-line">
              {urgent.slice(0, 10).map((l) => {
                const days = leadDaysLeft(l.broker_deadline);
                const b = t.dash.broker;
                const label = days === null ? "—" : days < 0 ? fill(b.expiredLabel, { n: Math.abs(days) }) : days === 0 ? b.todayLabel : fill(b.daysLeftLabel, { n: days });
                return (
                  <li key={l.id}>
                    <Link href={`/dashboard/clients/${l.id}`} className="dash-focus flex flex-wrap items-center justify-between gap-2 rounded px-1 py-2.5 hover:bg-surface-subtle">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">{l.name}</span>
                        <span className="text-xs text-ink-muted">
                          {[l.broker_companies?.name, tValue(l.stage ?? "ليد", locale), l.broker_deadline ? fmtShortDate(l.broker_deadline, locale) : null, l.last_contact_at ? fmtRelative(l.last_contact_at, locale) : tt.noContact].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <StatusBadge tone={days !== null && days < 0 ? "expired" : "critical"} label={days !== null && days < 0 ? st.expired : st.critical} />
                        <span className="text-xs font-semibold text-ink-secondary">{label}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </DashboardSection>
    </>
  );
}

export default async function RmDashboard() {
  const { t } = getI18n();
  const a = t.dash.actions;
  const name = await getEmployeeName();
  const actions: QuickAction[] = [
    { href: "/dashboard/brokers/requests", label: a.brokerRequests, icon: "real_estate_agent" },
    { href: "/dashboard/brokers/leads", label: t.nav.brokers, icon: "handshake" },
    { href: "/dashboard/tasks", label: a.myTasks, icon: "checklist" },
  ];
  return (
    <DashMain>
      <DashboardHeader name={name} actions={actions} />
      <Slot fallback={<SectionSkeleton height="h-96" />}><RmBody /></Slot>
      <Slot fallback={<SectionSkeleton height="h-48" title={false} />}><TodayTasks /></Slot>
    </DashMain>
  );
}
