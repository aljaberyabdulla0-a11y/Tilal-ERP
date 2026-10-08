import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getInventoryItems, getRecentMoves, lowStockItems, summarize } from "@/lib/inventory";
import { getTeamMembers } from "@/lib/projects";
import { getMyFollowUps } from "@/lib/client-followups";
import { STOCK_STATE_COLORS, formatQty, stockState } from "@/lib/types";
import { baghdadDate } from "@/lib/time";
import { fill, fmtMoney, fmtNumber } from "@/lib/dashboard/format";
import { countStatus, type Kpi } from "@/lib/dashboard/kpi";
import { getEmployeeName } from "./names";
import { DashboardHeader, type QuickAction } from "@/components/dashboard/page-header";
import { Slot } from "@/components/dashboard/slot";
import { KpiSkeleton, SectionSkeleton } from "@/components/dashboard/skeleton";
import { Card, CardTitle, DashboardSection, EmptyState, Icon, KpiGrid } from "@/components/dashboard/ui";
import TodayTasks from "@/components/today-tasks";
import ClientFollowUps from "@/components/client-followups";
import AttentionSection, { ATTENTION_BY_ROLE } from "../_sections/attention";
import ActivitySection from "../_sections/activity";
import { DashMain } from "./shared";

// ============================================================
// لوحة مدير المتابعة — أنضج نمط في المشروع، صار مرجع البقية:
// بطاقات قابلة للنقر، ولون حسب الحالة، وترتيب حسب الأولوية.
//
// الترتيب مقصود: ما ينفد أولاً (لأنه يوقف العمل)، ثم المتأخّر، ثم
// المتابعات، ثم الحركة الأخيرة للاطمئنان.
//
// تغيّر عن السابق: المهام تُعدّ في القاعدة (count) بدل جلب ٣٠٠ صفّ
// وعدّها هنا؛ والتحية والتاريخ بساعة بغداد؛ والنصوص من القاموس.
// ============================================================

async function FollowupKpis() {
  const { t } = getI18n();
  const k = t.dash.kpi;
  const supabase = await createClient();
  const today = baghdadDate();
  const [items, followUps, members, open, late, att] = await Promise.all([
    getInventoryItems(),
    getMyFollowUps(),
    getTeamMembers(),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["جديدة", "قيد التنفيذ"]),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["جديدة", "قيد التنفيذ"]).lt("due_date", today),
    supabase.from("attendance").select("employee_id").eq("work_date", today).not("check_in", "is", null),
  ]);
  const summary = summarize(items);
  const active = members.filter((m) => m.status === "active");
  const presentIds = new Set((att.data ?? []).map((a: { employee_id: string }) => a.employee_id));
  const present = active.filter((m) => presentIds.has(m.id)).length;
  const lateN = late.count ?? 0;

  const kpis: Kpi[] = [
    { key: "low", title: k.lowStock, value: summary.low, unit: "count", direction: "negative", icon: "warning", delta: null, href: "/dashboard/inventory?state=low", status: summary.low ? "warning" : "good" },
    { key: "items", title: k.stockItems, value: summary.items, unit: "count", direction: "neutral", icon: "inventory_2", delta: null, href: "/dashboard/inventory" },
    { key: "late", title: k.lateTasks, value: lateN, unit: "count", direction: "negative", icon: "assignment_late", delta: null, href: "/dashboard/tasks", status: countStatus(lateN), subtitle: `${t.dash.followup.openTasks}: ${fmtNumber(open.count ?? 0, getI18n().locale)}` },
    { key: "calls", title: k.dueCalls, value: followUps.total, unit: "count", direction: "negative", icon: "call", delta: null, href: "/dashboard/clients/activities", status: followUps.total ? "warning" : "good" },
    { key: "present", title: k.present, value: present, unit: "count", direction: "neutral", icon: "groups", delta: null, href: "/dashboard/followup/employees", subtitle: `${t.dash.common.of} ${active.length}` },
  ];
  return <div className="mb-6"><KpiGrid kpis={kpis} size="md" cols={5} label={t.dash.sections.primary} /></div>;
}

async function LowStock() {
  const { locale, t } = getI18n();
  const s = t.dash.sections;
  const tt = t.dash.table;
  const low = lowStockItems(await getInventoryItems());
  return (
    <DashboardSection id="inventory" title={s.inventory} href="/dashboard/inventory" linkLabel={t.dash.followup.inventoryAll}>
      <Card>
        {low.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-success-700"><Icon name="check_circle" />{t.dash.followup.allStocked}</p>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {low.slice(0, 8).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/dashboard/inventory/${i.id}`} className="dash-focus rounded text-sm font-semibold text-brand-700 hover:underline">{i.name}</Link>
                    <p className="text-xs text-ink-muted">
                      {tt.minQty}: {formatQty(i.min_quantity)} {i.unit}
                      {i.suppliers?.name ? ` · ${tt.supplier}: ${i.suppliers.name}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STOCK_STATE_COLORS[stockState(i)]}`}>
                      {formatQty(i.quantity)} {i.unit}
                    </span>
                    <Link
                      href={`/dashboard/inventory/moves/new?item=${i.id}&kind=${encodeURIComponent("شراء")}`}
                      className="dash-focus inline-flex items-center gap-1 rounded-lg bg-success-50 px-2.5 py-1 text-xs font-semibold text-success-700 hover:bg-success-100"
                    >
                      <Icon name="add_shopping_cart" className="text-[16px]" />
                      {t.dash.actions.purchase}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
            {low.length > 8 && <p className="mt-2 text-xs text-ink-muted">{fill(t.dash.followup.moreItems, { n: fmtNumber(low.length - 8, locale) })}</p>}
          </>
        )}
      </Card>
    </DashboardSection>
  );
}

async function RecentMoves() {
  const { locale, t } = getI18n();
  const s = t.dash.sections;
  const moves = await getRecentMoves(12);
  const purchases = moves.filter((m) => m.kind === "شراء").slice(0, 5);
  const issues = moves.filter((m) => m.kind === "صرف").slice(0, 5);
  const cur = t.dash.common.currency;
  const list = (rows: typeof moves, sign: "+" | "−") =>
    rows.length === 0 ? null : (
      <ul className="divide-y divide-line">
        {rows.map((m) => (
          <li key={m.id} className="py-2">
            <div className="flex justify-between gap-2 text-sm">
              <Link href={`/dashboard/inventory/${m.item_id}`} className="dash-focus truncate rounded font-medium text-ink hover:text-brand-700">{m.inventory_items?.name ?? "—"}</Link>
              <span className={`font-bold ${sign === "+" ? "text-success-700" : "text-danger-700"}`} dir="ltr">{sign}{formatQty(m.quantity)}</span>
            </div>
            <div className="mt-0.5 flex justify-between text-xs text-ink-muted">
              <span dir="ltr">{m.moved_at}</span>
              <span>{sign === "+" ? fmtMoney(m.total_price, locale, cur) : m.issued_to ?? m.actor_name ?? ""}</span>
            </div>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle href="/dashboard/inventory/moves" linkLabel={t.dash.common.viewAll}>{s.purchases}</CardTitle>
        {list(purchases, "+") ?? <EmptyState title={t.dash.followup.noPurchases} icon="shopping_cart" compact />}
      </Card>
      <Card>
        <CardTitle href="/dashboard/inventory/moves" linkLabel={t.dash.common.viewAll}>{s.issues}</CardTitle>
        {list(issues, "−") ?? <EmptyState title={t.dash.followup.noIssues} icon="outbox" compact />}
      </Card>
    </div>
  );
}

export default async function FollowupDashboard() {
  const { t } = getI18n();
  const a = t.dash.actions;
  const name = await getEmployeeName();
  const actions: QuickAction[] = [
    { href: `/dashboard/inventory/moves/new?kind=${encodeURIComponent("شراء")}`, label: a.purchase, icon: "add_shopping_cart" },
    { href: "/dashboard/tasks/new", label: a.newTask, icon: "add_task" },
    { href: "/dashboard/clients/activities", label: t.nav.contacts, icon: "call" },
    { href: "/dashboard/followup/employees", label: t.nav.employees, icon: "supervisor_account" },
  ];
  return (
    <DashMain>
      <DashboardHeader name={name} subtitle={t.dash.subtitle.followup} actions={actions} />
      <Slot fallback={<KpiSkeleton count={5} />}><FollowupKpis /></Slot>
      {/* الـCRM قبل المخزون: الليد المهمل يُفقَد ولا يُعوَّض */}
      <Slot fallback={null}><AttentionSection projectId={null} include={ATTENTION_BY_ROLE.followup} /></Slot>
      <Slot fallback={<SectionSkeleton height="h-64" />}><LowStock /></Slot>
      <section aria-label={t.dash.sections.myWork} className="mb-6 grid gap-4 lg:grid-cols-2">
        <Slot fallback={<SectionSkeleton height="h-48" title={false} />}><TodayTasks /></Slot>
        <Slot fallback={null}><ClientFollowUps compact /></Slot>
      </section>
      <section className="mb-6"><Slot fallback={<SectionSkeleton height="h-56" title={false} />}><RecentMoves /></Slot></section>
      <Slot fallback={<SectionSkeleton height="h-72" title={false} />}><ActivitySection projectId={null} limit={10} /></Slot>
    </DashMain>
  );
}
