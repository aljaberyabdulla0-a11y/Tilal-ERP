import { getI18n } from "@/lib/i18n/server";
import { engineCompare, getPeriodPnl, getUnits, type Totals } from "@/lib/dashboard/data";
import { drillHref, engineFilters, rangeHref, type DashFilters } from "@/lib/dashboard/period";
import { fill, fmtNumber } from "@/lib/dashboard/format";
import { makeKpi, num, type Kpi } from "@/lib/dashboard/kpi";
import { KpiGrid } from "@/components/dashboard/ui";
import { ErrorState } from "@/components/dashboard/states";

// ============================================================
// المؤشّرات التنفيذية بثلاث طبقات — لا ثلاثون بطاقة في صفّ:
//
//   رئيسية (٤)   المبيعات · المحصّل · صافي التدفق · الحجوزات
//   ثانوية (٤)   المبيعة · المتاحة · النشطون · التحويل
//   تشغيلية (٦)  ليدات · تواصل · متوسط الصفقة · دورة البيع · خسائر · أنبوب موزون
//
// المصادر — وكلٌّ يُتتبَّع:
//   المبيعات وما بعدها  ← crm_report_query بسجلّ crm_metrics (نفس التقارير)
//   المحصّل والصافي     ← account_balances (نفس «قائمة الدخل» وصفحة المالية)
//   المتاحة             ← dashboard_units (182) — لقطة الآن بلا مقارنة
//
// ⚠️ «إجمالي المبيعات» قيمة الصفقات الفائزة (REVENUE) لا سعر قائمة
//    الوحدات المباعة (H2)، و«المحصّل» من الدفتر لا من جدول payments (H3).
// ============================================================

export const EXEC_METRICS = [
  "REVENUE", "RESERVATIONS", "WON_DEALS", "OPEN_LEADS", "CONVERSION_RATE",
  "NEW_LEADS", "TOTAL_ACTIVITIES", "AVG_DEAL_VALUE", "AVG_SALES_CYCLE", "LOST_DEALS", "WEIGHTED_PIPELINE",
];

export default async function ExecutiveKpis({ f, finance }: { f: DashFilters; finance: boolean }) {
  const { locale, t } = getI18n();
  const k = t.dash.kpi;
  const s = t.dash.sections;
  const filters = engineFilters(f);

  const [eng, pnl, pnlPrev, units] = await Promise.all([
    engineCompare(EXEC_METRICS, f.range, f.previous, filters, f.today),
    finance ? getPeriodPnl(f.range) : Promise.resolve(null),
    finance && f.previous ? getPeriodPnl(f.previous) : Promise.resolve(null),
    getUnits(f.project),
  ]);

  if (!eng.ok) return <ErrorState detail={eng.error} />;
  const cur: Totals = eng.data.cur;
  const prev: Totals | null = eng.data.prev;
  const p = (code: string) => (prev ? num(prev[code]) : undefined);
  const c = (code: string) => num(cur[code]);

  const unitRows = units.ok ? units.data : [];
  const unitsTotal = unitRows.reduce((acc, u) => acc + u.total, 0);
  const unitsAvailable = units.ok ? unitRows.reduce((acc, u) => acc + u.available, 0) : null;

  const pnlCur = pnl && pnl.ok ? pnl.data : null;
  const pnlPrv = pnlPrev && pnlPrev.ok ? pnlPrev.data : null;
  const statement = rangeHref("/dashboard/accounting/reports/income-statement", f);

  const primary: Kpi[] = [
    makeKpi({ key: "sales", title: k.sales, value: c("REVENUE"), unit: "money", direction: "positive", icon: "payments", href: drillHref("REVENUE", f), definition: k.salesDef, source: "crm_report_query:REVENUE" }, p("REVENUE")),
    ...(finance
      ? [
          makeKpi({ key: "collected", title: k.collected, value: pnlCur?.income ?? null, unit: "money", direction: "positive", icon: "account_balance_wallet", href: statement, definition: k.collectedDef, source: "account_balances:revenue" }, pnlPrv ? pnlPrv.income : f.previous ? null : undefined),
          makeKpi({ key: "net", title: k.netCash, value: pnlCur?.net ?? null, unit: "money", direction: "positive", icon: "account_balance", href: statement, definition: k.netCashDef, source: "account_balances:revenue-expense", status: pnlCur && pnlCur.net < 0 ? "danger" : "neutral" }, pnlPrv ? pnlPrv.net : f.previous ? null : undefined),
        ]
      : []),
    makeKpi({ key: "reservations", title: k.reservations, value: c("RESERVATIONS"), unit: "count", direction: "positive", icon: "key", href: drillHref("RESERVATIONS", f), definition: k.reservationsDef, source: "crm_report_query:RESERVATIONS" }, p("RESERVATIONS")),
  ];

  const secondary: Kpi[] = [
    makeKpi({ key: "won", title: k.wonDeals, value: c("WON_DEALS"), unit: "count", direction: "positive", icon: "check_circle", href: drillHref("WON_DEALS", f), definition: k.wonDealsDef, source: "crm_report_query:WON_DEALS" }, p("WON_DEALS")),
    {
      key: "available", title: k.unitsAvailable, value: unitsAvailable, unit: "count", direction: "neutral", icon: "apartment",
      href: `/dashboard/units?status=${encodeURIComponent("متاحة")}`, delta: null, definition: k.unitsAvailableDef, source: "dashboard_units",
      subtitle: units.ok ? fill(k.unitsOf, { total: fmtNumber(unitsTotal, locale) }) : undefined,
    },
    makeKpi({ key: "active", title: k.activeLeads, value: c("OPEN_LEADS"), unit: "count", direction: "neutral", icon: "groups", href: drillHref("OPEN_LEADS", f), definition: k.activeLeadsDef, source: "crm_report_query:OPEN_LEADS" }, p("OPEN_LEADS")),
    makeKpi({ key: "conversion", title: k.conversion, value: c("CONVERSION_RATE"), unit: "pct", direction: "positive", icon: "conversion_path", href: drillHref("CONVERSION_RATE", f), definition: k.conversionDef, source: "crm_report_query:CONVERSION_RATE" }, p("CONVERSION_RATE")),
  ];

  const operational: Kpi[] = [
    makeKpi({ key: "leads", title: k.newLeads, value: c("NEW_LEADS"), unit: "count", direction: "positive", icon: "person_add", href: drillHref("NEW_LEADS", f), definition: k.newLeadsDef }, p("NEW_LEADS")),
    makeKpi({ key: "acts", title: k.activities, value: c("TOTAL_ACTIVITIES"), unit: "count", direction: "positive", icon: "call", href: drillHref("TOTAL_ACTIVITIES", f), definition: k.activitiesDef }, p("TOTAL_ACTIVITIES")),
    makeKpi({ key: "avg", title: k.avgDeal, value: c("AVG_DEAL_VALUE"), unit: "money", direction: "positive", icon: "sell", href: drillHref("AVG_DEAL_VALUE", f), definition: k.avgDealDef }, p("AVG_DEAL_VALUE")),
    makeKpi({ key: "cycle", title: k.salesCycle, value: c("AVG_SALES_CYCLE"), unit: "days", direction: "negative", icon: "timelapse", href: drillHref("AVG_SALES_CYCLE", f), definition: k.salesCycleDef }, p("AVG_SALES_CYCLE")),
    makeKpi({ key: "lost", title: k.lostDeals, value: c("LOST_DEALS"), unit: "count", direction: "negative", icon: "trending_down", href: `/dashboard/crm/lost?from=${f.range.from}&to=${f.range.to}`, definition: k.lostDealsDef }, p("LOST_DEALS")),
    makeKpi({ key: "wpipe", title: k.weightedPipeline, value: c("WEIGHTED_PIPELINE"), unit: "money", direction: "positive", icon: "stacked_line_chart", href: drillHref("WEIGHTED_PIPELINE", f), definition: k.weightedPipelineDef }, p("WEIGHTED_PIPELINE")),
  ];

  return (
    <div className="mb-6 space-y-3">
      <h2 className="sr-only">{s.primary}</h2>
      <KpiGrid kpis={primary} size="lg" cols={4} label={s.primary} />
      <h2 className="sr-only">{s.secondary}</h2>
      <KpiGrid kpis={secondary} size="md" cols={4} label={s.secondary} />
      <h2 className="sr-only">{s.operational}</h2>
      <KpiGrid kpis={operational} size="sm" cols={6} label={s.operational} />
    </div>
  );
}
