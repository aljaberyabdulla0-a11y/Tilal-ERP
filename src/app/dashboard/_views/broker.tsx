import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { tValue } from "@/lib/i18n/values";
import { createClient } from "@/lib/supabase/server";
import {
  companyMoney, getBrokerCommissions, getBrokerDashboardSummary, getBrokerPayments,
  getBrokerRequests, getMyBrokerCompany, paidByCommission,
} from "@/lib/brokers";
import { isOpenBrokerRequest, leadDaysLeft } from "@/lib/types";
import { baghdadDate } from "@/lib/time";
import { addDays } from "@/lib/report-dates";
import { fill, fmtMoney, fmtShortDate } from "@/lib/dashboard/format";
import { countStatus, type Kpi } from "@/lib/dashboard/kpi";
import { DashboardHeader, type QuickAction } from "@/components/dashboard/page-header";
import { Slot } from "@/components/dashboard/slot";
import { KpiSkeleton, SectionSkeleton } from "@/components/dashboard/skeleton";
import { Card, CardTitle, DashboardSection, EmptyState, Icon, KpiGrid, StatTile, StatusBadge } from "@/components/dashboard/ui";
import { ErrorState } from "@/components/dashboard/states";
import { DashMain } from "./shared";

// ============================================================
// لوحة الشركة الوسيطة — سؤالها الأول: «أي ليد سأخسره؟».
// فالمهل أولاً، ثم الليدات والطلبات، ثم المال.
//
// العدّادات من broker_dashboard_summary (130) لا من جلب كل الليدات
// وتصنيفها هنا — كان ذلك يتجاوز ١٠٠٠ صفّ لشركة كبيرة فينقص بصمت.
// وقائمة المهل تُطلب مقصوصة: الأقرب انتهاءً، والمنتهية حديثاً.
//
// حالة المهلة: منتهية (< ٠) · حرجة (٠–١ يوم) · عاجلة (٢–٣) — بأيقونة
// ونصّ لا لونٍ وحده.
// ============================================================

type LeadRow = { id: string; name: string; stage: string | null; broker_deadline: string | null; projects: { name: string } | null };

function deadlineTone(days: number | null): { tone: string; key: "expired" | "critical" | "urgent" | "active" } {
  if (days === null) return { tone: "neutral", key: "active" };
  if (days < 0) return { tone: "expired", key: "expired" };
  if (days <= 1) return { tone: "critical", key: "critical" };
  if (days <= 3) return { tone: "urgent", key: "urgent" };
  return { tone: "active", key: "active" };
}

async function Deadlines() {
  const { locale, t } = getI18n();
  const s = t.dash.sections;
  const tt = t.dash.table;
  const b = t.dash.broker;
  const supabase = await createClient();
  const today = baghdadDate();
  const base = () =>
    supabase
      .from("clients")
      .select("id, name, stage, broker_deadline, projects(name)")
      .not("broker_company_id", "is", null)
      .is("deleted_at", null)
      .or(`stage.is.null,stage.not.in.("بيع","فشل البيع")`);
  const [soon, expired] = await Promise.all([
    base().gte("broker_deadline", today).lte("broker_deadline", addDays(today, 3)).order("broker_deadline", { ascending: true }).limit(10),
    base().lt("broker_deadline", today).order("broker_deadline", { ascending: false }).limit(5),
  ]);
  if (soon.error) return <ErrorState detail={soon.error.message} />;
  const rows = [...((soon.data ?? []) as unknown as LeadRow[]), ...((expired.data ?? []) as unknown as LeadRow[])];

  return (
    <DashboardSection id="deadlines" title={s.deadlines} hint={s.deadlinesHint} href="/dashboard/broker/leads" linkLabel={b.allLeads}>
      <Card>
        {rows.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-success-700"><Icon name="check_circle" />{b.noDeadlines}</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((l) => {
              const days = leadDaysLeft(l.broker_deadline);
              const st = deadlineTone(days);
              const label = days === null ? "—" : days < 0 ? fill(b.expiredLabel, { n: Math.abs(days) }) : days === 0 ? b.todayLabel : fill(b.daysLeftLabel, { n: days });
              return (
                <li key={l.id}>
                  <Link href={`/dashboard/broker/leads/${l.id}`} className="dash-focus flex flex-wrap items-center justify-between gap-2 rounded px-1 py-2.5 hover:bg-surface-subtle">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{l.name}</span>
                      <span className="text-xs text-ink-muted">
                        {[l.projects?.name, tValue(l.stage ?? "ليد", locale), l.broker_deadline ? `${tt.deadline}: ${fmtShortDate(l.broker_deadline, locale)}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge tone={st.tone} label={t.dash.status[st.key]} />
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
  );
}

async function BrokerKpisAndMoney() {
  const { t } = getI18n();
  const k = t.dash.kpi;
  const s = t.dash.sections;
  const [summary, requests] = await Promise.all([getBrokerDashboardSummary(), getBrokerRequests()]);
  const openReq = requests.filter((r) => isOpenBrokerRequest(r.status)).length;
  // الملخّص هو المصدر؛ وإن لم يُرجع شيئاً (دالّة غير مطبّقة) نحسب المال احتياطاً كما كانت اللوحة
  let fallback: ReturnType<typeof companyMoney> | null = null;
  if (!summary) {
    const [commissions, payments] = await Promise.all([getBrokerCommissions(), getBrokerPayments()]);
    fallback = companyMoney(commissions, paidByCommission(payments));
  }
  const urgent = summary ? Number(summary.expiring_leads) : null;

  const kpis: Kpi[] = [
    { key: "urgent", title: k.urgentDeadlines, value: urgent, unit: "count", direction: "negative", icon: "hourglass_bottom", delta: null, href: "/dashboard/broker/leads", status: countStatus(urgent) },
    { key: "active", title: k.activeBrokerLeads, value: summary ? Number(summary.active_leads) : null, unit: "count", direction: "neutral", icon: "groups", delta: null, href: "/dashboard/broker/leads" },
    { key: "req", title: k.pendingBrokerRequests, value: summary ? Number(summary.pending_requests) : openReq, unit: "count", direction: "neutral", icon: "event_available", delta: null, href: "/dashboard/broker/requests", status: summary && Number(summary.needs_info) > 0 ? "warning" : "neutral" },
    { key: "deals", title: k.dealsAndSales, value: summary ? Number(summary.completed_sales) : fallback?.deals ?? null, unit: "count", direction: "positive", icon: "handshake", delta: null, href: "/dashboard/broker/commissions", subtitle: summary ? `${k.reservations}: ${summary.active_deals}` : undefined },
  ];

  return (
    <>
      <div className="mb-4"><KpiGrid kpis={kpis} size="md" cols={4} label={s.primary} /></div>
      <DashboardSection id="money" title={s.money} href="/dashboard/broker/commissions" linkLabel={t.dash.broker.allCommissions}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {summary ? (
            <>
              <StatTile label={k.earned} value={Number(summary.commission_earned)} unit="money" href="/dashboard/broker/commissions" />
              <StatTile label={k.payable} value={Number(summary.commission_payable)} unit="money" tone="good" href="/dashboard/broker/commissions" />
              <StatTile label={k.waitingCollection} value={Number(summary.commission_pending)} unit="money" tone="warning" href="/dashboard/broker/commissions" />
              <StatTile label={k.paid} value={Number(summary.commission_paid)} unit="money" href="/dashboard/broker/commissions" />
            </>
          ) : fallback ? (
            <>
              <StatTile label={k.earned} value={fallback.earned} unit="money" />
              <StatTile label={k.remaining} value={fallback.remaining} unit="money" tone="warning" />
              <StatTile label={k.paid} value={fallback.paid} unit="money" />
            </>
          ) : null}
        </div>
      </DashboardSection>
    </>
  );
}

async function RequestsAndCommissions() {
  const { locale, t } = getI18n();
  const s = t.dash.sections;
  const b = t.dash.broker;
  const [requests, commissions] = await Promise.all([getBrokerRequests(), getBrokerCommissions()]);
  const open = requests.filter((r) => isOpenBrokerRequest(r.status)).slice(0, 5);
  const cur = t.dash.common.currency;
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle href="/dashboard/broker/requests" linkLabel={b.allRequests}>{s.requests}</CardTitle>
        {open.length === 0 ? <EmptyState title={t.dash.common.empty} icon="event_available" compact /> : (
          <ul className="divide-y divide-line">
            {open.map((r) => (
              <li key={r.id}>
                <Link href={`/dashboard/broker/requests/${r.id}`} className="dash-focus flex items-center justify-between gap-2 rounded px-1 py-2.5 hover:bg-surface-subtle">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{fill(b.unitLabel, { code: r.unit_code ?? "—" })}</span>
                    <span className="text-xs text-ink-muted">{[r.client_name ?? r.clients?.name, r.projects?.name].filter(Boolean).join(" · ")}</span>
                  </span>
                  <StatusBadge tone={r.status === "بحاجة لمعلومات" ? "warning" : "info"} label={tValue(r.status, locale)} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardTitle href="/dashboard/broker/commissions" linkLabel={b.allCommissions}>{s.commissions}</CardTitle>
        {commissions.length === 0 ? <EmptyState title={b.noCommissions} icon="payments" compact /> : (
          <ul className="divide-y divide-line">
            {commissions.slice(0, 5).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{c.clients?.name ?? "—"}</span>
                  <span className="text-xs text-ink-muted" dir="ltr">{c.earned_at}</span>
                </span>
                <span className="text-sm font-bold text-ink">{fmtMoney(Number(c.amount), locale, cur)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default async function BrokerDashboard() {
  const { t } = getI18n();
  const a = t.dash.actions;
  const company = await getMyBrokerCompany();
  const actions: QuickAction[] = [
    { href: "/dashboard/broker/units", label: a.brokerUnits, icon: "apartment" },
    { href: "/dashboard/broker/leads/new", label: a.newBrokerLead, icon: "person_add" },
  ];
  return (
    <DashMain>
      <DashboardHeader subtitle={fill(t.dash.subtitle.broker, { company: company?.name ?? t.dash.subtitle.brokerFallback })} actions={actions} />
      <Slot fallback={<SectionSkeleton height="h-64" />}><Deadlines /></Slot>
      <Slot fallback={<KpiSkeleton />}><BrokerKpisAndMoney /></Slot>
      <Slot fallback={<SectionSkeleton height="h-56" title={false} />}><RequestsAndCommissions /></Slot>
    </DashMain>
  );
}
