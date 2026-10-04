import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { baghdadDate } from "@/lib/time";
import { requireMktRead } from "@/lib/marketing-guard";
import { addDays, parseMktFilters, presetRange, withParams } from "@/lib/marketing-filters";
import {
  getApprovals, getBreakdown, getBudgetStatus, getCalendar, getKpis, getKpisFor, getOpenAlerts,
} from "@/lib/marketing";
import { fmt, fmtPct } from "@/lib/marketing-style";
import { Badge, Card, Empty, MktFilterBar, PageHead, Tile, Unavailable } from "@/components/marketing/ui";
import { HBars } from "@/components/marketing/charts";

// ============================================================
// لوحة التسويق — ما يُفتح كل صباح.
//
// ثلاث طبقات من الأعلى: (١) أرقام المدة المختارة كما يحسبها mkt_kpis،
// (٢) أين ذهب المال وماذا جاء به — بالقناة والحملة والمشروع، (٣) ما
// ينتظر فعلاً: موافقات، تنبيهات، مصروفٌ معتمد لم يُدفع، ما يُنشر قريباً.
//
// والإيراد عمولة تلال لا ثمن الوحدة (056)؛ وقيمة البيع تُعرض باسمها.
// ============================================================
export default async function MarketingHome({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const today = baghdadDate();
  const f = parseMktFilters(searchParams, today);

  const [kpis, byChannel, byCampaign, byProject, approvals, alerts, budgets, upcoming, monthK, quarterK, yearK] =
    await Promise.all([
      getKpis(f),
      getBreakdown("channel", f),
      getBreakdown("campaign", f),
      getBreakdown("project", f),
      getApprovals("معلّق"),
      getOpenAlerts(6),
      getBudgetStatus(today, today),
      getCalendar(today, addDays(today, 14)),
      getKpisFor(presetRange("month", today)),
      getKpisFor(presetRange("quarter", today)),
      getKpisFor(presetRange("year", today)),
    ]);

  const supabase = await createClient();
  const { count: awaitingPay } = await supabase
    .from("mkt_expenses").select("id", { count: "exact", head: true }).eq("status", "معتمد");

  const k = kpis.data;
  const companyBudget = budgets.data.filter((b) => b.scope === "شركة" && b.status === "معتمدة");
  const budgetAlerts = budgets.data.filter((b) => b.alert_level);
  const base = "/dashboard/marketing";

  return (
    <>
      <PageHead
        title="التسويق"
        sub="من الإعلان إلى عمولة تلال: الكلفة من الدفتر، والليد من الـCRM، والبيعة من العمولات — والإسناد بالنموذج المختار."
        actions={
          <>
            <Link href={`${base}/campaigns/new`} className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700">حملة جديدة</Link>
            <Link href={`${base}/executive`} className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50">اللوحة التنفيذية</Link>
          </>
        }
      />
      <MktFilterBar basePath={base} f={f} showModel />
      <Unavailable error={kpis.error} />

      {k && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Tile label="كلفة التسويق" value={fmt(k.cost)} sub={`مدفوع ${fmt(k.spend)} · مواد ${fmt(k.materials)}`} />
          <Tile label="ليدات" value={fmt(k.leads)} sub={`مؤهَّلون ${fmt(k.qualified)}`} />
          <Tile label="حجوزات" value={fmt(k.reservations)} sub={`من فوج الليدات`} />
          <Tile label="بيعات منسوبة" value={fmt(k.sales)} tone="brand" sub={`قيمتها ${fmt(k.sale_value)}`} />
          <Tile label="عمولة تلال المنسوبة" value={fmt(k.commission)} tone="brand" sub="الإيراد الحقيقي" />
          <Tile label="العائد ROI" value={fmtPct(k.roi)} tone={k.roi == null ? undefined : k.roi >= 0 ? "brand" : "bad"}
            sub={k.roi == null ? "لا كلفة مسجّلة" : `على قيمة البيع ${fmtPct(k.roi_value)}`} />
          <Tile label="كلفة الليد CPL" value={fmt(k.cpl)} sub={k.cpl == null ? "لا كلفة أو لا ليدات" : undefined} />
          <Tile label="كلفة المؤهَّل CPQL" value={fmt(k.cpql)} />
          <Tile label="كلفة الحجز CPA" value={fmt(k.cpa)} />
          <Tile label="كلفة الاستحواذ CAC" value={fmt(k.cac)} />
          <Tile label="عائد الإعلان ROAS" value={k.roas == null ? "—" : `${fmt(k.roas)}×`} sub={`مصروف إعلان ${fmt(k.ad_spend)}`} />
          <Tile label="ليد ← بيع" value={fmtPct(k.lead_to_sale)} sub={`ليد ← حجز ${fmtPct(k.lead_to_reservation)}`} />
        </section>
      )}

      <section className="grid gap-3 md:grid-cols-4">
        <Tile label="مصروف هذا الشهر" value={fmt(monthK?.cost)} />
        <Tile label="مصروف هذا الربع" value={fmt(quarterK?.cost)} />
        <Tile label="مصروف هذه السنة" value={fmt(yearK?.cost)} />
        <Tile
          label="ميزانية الشركة الجارية"
          value={companyBudget.length ? fmt(companyBudget.reduce((s, b) => s + Number(b.approved ?? b.planned), 0)) : "—"}
          sub={companyBudget.length
            ? `المتبقّي ${fmt(companyBudget.reduce((s, b) => s + Number(b.remaining), 0))}`
            : "لا ميزانية معتمدة تشمل اليوم"}
          href={`${base}/budget`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="الليدات بالقناة" className="lg:col-span-1">
          <HBars rows={byChannel.data.map((r) => ({
            key: r.dim_key ?? "none", label: r.label, value: Number(r.leads),
            note: r.cpl != null ? `· ${fmt(r.cpl)}/ليد` : undefined,
          }))} />
        </Card>
        <Card title="الكلفة بالقناة">
          <HBars rows={byChannel.data.filter((r) => Number(r.cost) > 0).map((r) => ({
            key: r.dim_key ?? "none", label: r.label, value: Number(r.cost),
          }))} empty="لا مصروف مدفوع في المدة" />
        </Card>
        <Card title="العمولة المنسوبة بالمشروع">
          <HBars rows={byProject.data.filter((r) => Number(r.commission) > 0).map((r) => ({
            key: r.dim_key ?? "none", label: r.label, value: Number(r.commission),
            href: r.dim_key ? `${base}/projects/${r.dim_key}` : undefined,
          }))} empty="لا بيعات منسوبة في المدة" />
        </Card>
      </div>

      <Card title="أداء الحملات" actions={<Link href={withParams(`${base}/analytics`, f.params, { dim: "campaign" })} className="text-xs text-brand-600 hover:underline">التقرير الكامل</Link>}>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                {["الحملة", "الكلفة", "ليدات", "مؤهَّل", "حجز", "بيع", "عمولة", "CPL", "CAC", "ROI"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byCampaign.data.slice(0, 10).map((r) => (
                <tr key={r.dim_key ?? "none"}>
                  <td className="px-3 py-2">
                    {r.dim_key ? <Link href={`${base}/campaigns/${r.dim_key}`} className="font-medium text-gray-800 hover:text-brand-600">{r.label}</Link>
                      : <span className="text-gray-500">{r.label}</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmt(r.cost)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmt(r.leads)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmt(r.qualified)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmt(r.reservations)}</td>
                  <td className="px-3 py-2 tabular-nums font-semibold text-brand-700">{fmt(r.sales)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmt(r.commission)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmt(r.cpl)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmt(r.cac)}</td>
                  <td className={`px-3 py-2 tabular-nums ${r.roi == null ? "text-gray-400" : Number(r.roi) >= 0 ? "text-brand-700" : "text-red-600"}`}>{fmtPct(r.roi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {byCampaign.data.length === 0 && <Empty>لا نشاط في المدة.</Empty>}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`بانتظار الموافقة (${approvals.length})`} actions={<Link href={`${base}/approvals`} className="text-xs text-brand-600 hover:underline">الكل</Link>}>
          {approvals.length === 0 ? <Empty>لا شيء ينتظر.</Empty> : (
            <ul className="divide-y divide-gray-100 text-sm">
              {approvals.slice(0, 6).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="truncate"><span className="text-xs text-gray-400">{a.entity_type} · </span>{a.title}</span>
                  <span className="shrink-0 text-xs text-gray-500">{a.approver}</span>
                </li>
              ))}
            </ul>
          )}
          {(awaitingPay ?? 0) > 0 && (
            <Link href={`${base}/expenses?status=معتمد`} className="mt-3 block rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {awaitingPay} مصروفاً معتمداً بانتظار دفع المالية
            </Link>
          )}
        </Card>

        <Card title="تنبيهات" actions={<Link href={`${base}/automation`} className="text-xs text-brand-600 hover:underline">الكل</Link>}>
          {alerts.length === 0 && budgetAlerts.length === 0 ? <Empty>لا تنبيهات مفتوحة.</Empty> : (
            <ul className="space-y-2 text-sm">
              {budgetAlerts.map((b) => (
                <li key={b.budget_id} className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  ميزانية {b.name}: {b.alert_level} — {fmtPct(b.utilization_pct)}
                </li>
              ))}
              {alerts.map((a) => (
                <li key={a.id} className="rounded border border-gray-200 px-3 py-2">
                  <Link href={a.link ?? `${base}/automation`} className="font-medium text-gray-800 hover:text-brand-600">{a.title}</Link>
                  {a.body && <p className="text-xs text-gray-500">{a.body}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="الأسبوعان القادمان" actions={<Link href={`${base}/calendar`} className="text-xs text-brand-600 hover:underline">التقويم</Link>}>
          {upcoming.data.length === 0 ? <Empty>لا شيء مجدول.</Empty> : (
            <ul className="divide-y divide-gray-100 text-sm">
              {upcoming.data.slice(0, 10).map((c) => (
                <li key={`${c.kind}-${c.id}`} className="flex items-center justify-between gap-2 py-2">
                  <Link href={c.href} className="truncate hover:text-brand-600">
                    <span className="text-xs text-gray-400">{c.kind} · </span>{c.title}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500" dir="ltr">{c.starts}<Badge>{c.status}</Badge></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
