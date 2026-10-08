import { getI18n } from "@/lib/i18n/server";
import { getMoney } from "@/lib/dashboard/data";
import { fmtBucket } from "@/lib/dashboard/format";
import { Card, CardTitle, DashboardSection, EmptyState, StatTile } from "@/components/dashboard/ui";
import { BarList, ColumnPairs } from "@/components/dashboard/charts";
import { ErrorState } from "@/components/dashboard/states";

// ============================================================
// الإيرادات والنقد — من money_overview (112) **وحدها**.
//
// هي نفس دالّة صفحة المالية (getMoneyOverview)، فلا يرى المدير رقماً
// هنا ورقماً آخر عند المحاسب لنفس السؤال (H3). كانت اللوحة تجمع
// جدول payments في TypeScript — دفعات الفواتير فقط وبلا حدّ ١٠٠٠ صفّ.
//
// الدالّة ليست بفترة: النقد والالتزامات «الآن»، والأشهر الستة الأخيرة
// بتوقيت بغداد. أمّا دخل الفترة المختارة فبطاقته في المؤشّرات الرئيسية
// من account_balances (قائمة الدخل).
// ============================================================

export default async function FinanceSection({ today }: { today: string }) {
  const { locale, t } = getI18n();
  const s = t.dash.sections;
  const k = t.dash.kpi;
  const money = await getMoney(today);

  return (
    <DashboardSection id="finance" title={s.finance} hint={s.financeHint} href="/dashboard/finance" linkLabel={t.dash.common.viewAll}>
      {!money.ok ? (
        <ErrorState detail={money.error} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-6">
            <StatTile label={k.cash} value={money.data.cash} unit="money" href="/dashboard/accounting" hint={k.cashDef} tone={money.data.cash < 0 ? "danger" : "neutral"} />
            <StatTile label={k.monthIncome} value={money.data.monthIncome} unit="money" href="/dashboard/accounting/reports/income-statement" />
            <StatTile label={k.monthExpense} value={money.data.monthExpense} unit="money" href="/dashboard/accounting/moves" />
            <StatTile label={k.payrollDue} value={money.data.payrollDue} unit="money" href="/dashboard/accounting/ledger/2300" tone={money.data.payrollDue > 0 ? "warning" : "neutral"} />
            <StatTile label={k.partnerDue} value={money.data.partnerDue} unit="money" href="/dashboard/accounting/partners" />
            <StatTile label={k.developerDue} value={money.data.developerDue} unit="money" href="/dashboard/accounting/ledger/1250" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardTitle href="/dashboard/accounting/reports/income-statement" linkLabel={t.dash.common.details}>{s.incomeVsExpense}</CardTitle>
              {money.data.months.every((m) => m.income === 0 && m.expense === 0) ? (
                <EmptyState title={t.dash.charts.noData} icon="bar_chart" />
              ) : (
                <ColumnPairs
                  title={s.incomeVsExpense}
                  unit="money"
                  aLabel={t.dash.charts.income}
                  bLabel={t.dash.charts.expense}
                  groups={money.data.months.map((m) => ({ key: m.key, label: fmtBucket(m.key, "month", locale), a: m.income, b: m.expense }))}
                />
              )}
            </Card>
            <Card>
              <CardTitle href="/dashboard/accounting/reports/income-statement" linkLabel={t.dash.common.details}>{s.expenseByCategory}</CardTitle>
              {money.data.byCategory.length === 0 ? (
                <EmptyState title={t.dash.common.empty} icon="pie_chart" compact />
              ) : (
                <BarList
                  title={s.expenseByCategory}
                  unit="money"
                  color="var(--viz-2)"
                  rows={money.data.byCategory.map((b) => ({ key: b.label, label: b.label, value: b.amount }))}
                />
              )}
            </Card>
          </div>
        </>
      )}
    </DashboardSection>
  );
}
