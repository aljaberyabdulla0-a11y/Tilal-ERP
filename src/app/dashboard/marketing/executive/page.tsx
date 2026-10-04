import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { baghdadDate } from "@/lib/time";
import { addDays, parseMktFilters, previousRange } from "@/lib/marketing-filters";
import { getBreakdown, getBudgetStatus, getForecast, getKpisFor, getObjectiveProgress, getTrend, type BreakdownRow, type Kpis } from "@/lib/marketing";
import { ATTRIBUTION_MODELS, METRIC_LABELS, fmt, fmtPct } from "@/lib/marketing-style";
import { Card, MktFilterBar, PageHead, Unavailable } from "@/components/marketing/ui";
import { Columns } from "@/components/marketing/charts";

// ============================================================
// اللوحة التنفيذية — ما يسأله المالك:
//   كم صرفنا؟ ماذا جلب؟ كم ربحنا منه؟ أين الأفضل؟ هل نحن على الهدف؟
//   وماذا يحدث لو صرفنا كذا الشهر القادم؟
//
// كل رقم بجانب نظيره في الفترة السابقة بنفس الطول، والعائد على عمولة
// تلال (لا قيمة الوحدات).
// ============================================================
function delta(cur: number | null | undefined, prev: number | null | undefined, lowerIsBetter = false) {
  if (cur == null || prev == null || Number(prev) === 0) return null;
  const d = ((Number(cur) - Number(prev)) * 100) / Math.abs(Number(prev));
  const good = lowerIsBetter ? d < 0 : d > 0;
  return <span className={`text-xs ${Math.abs(d) < 0.5 ? "text-gray-400" : good ? "text-brand-700" : "text-red-600"}`}>{d > 0 ? "▲" : "▼"} {fmt(Math.abs(Math.round(d)))}٪</span>;
}

function top(rows: BreakdownRow[], by: "commission" | "leads" = "commission") {
  return rows.filter((r) => r.dim_key).sort((a, b) => Number(b[by]) - Number(a[by]) || Number(b.leads) - Number(a.leads))[0];
}

export default async function ExecutivePage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const today = baghdadDate();
  const f = parseMktFilters(searchParams, today);
  const from = f.from ?? addDays(today, -364);
  const to = f.to ?? today;
  const prev = previousRange(from, to);

  const [cur, before, campaigns, channels, projects, content, influencers, employees, budgets, trend] = await Promise.all([
    getKpisFor({ from, to }, f), getKpisFor(prev, f),
    getBreakdown("campaign", f), getBreakdown("channel", f), getBreakdown("project", f),
    getBreakdown("content", f), getBreakdown("influencer", f), getBreakdown("employee", f),
    getBudgetStatus(today, today), getTrend("month", { ...f, from: addDays(today, -364), to: today }),
  ]);

  // ميزانية الشهر القادم المقترحة للتنبؤ: متوسط كلفة آخر ثلاثة أشهر — أو ما يُكتب
  const recent = trend.data.slice(-3);
  const avgMonthly = recent.length ? Math.round(recent.reduce((s, t) => s + Number(t.cost), 0) / recent.length) : 0;
  const budget = Number(searchParams.budget) > 0 ? Number(searchParams.budget) : avgMonthly;
  const forecast = budget > 0 ? await getForecast(budget, 3, f.project, f.channel) : null;

  const supabase = await createClient();
  const { data: plans } = await supabase.from("mkt_plans").select("id, title").eq("status", "معتمدة")
    .lte("period_start", today).gte("period_end", today).order("period_start").limit(3);
  const progress = await Promise.all((plans ?? []).map(async (p) => ({ plan: p, rows: (await getObjectiveProgress(p.id)).data })));

  const k = cur;
  const rowsCmp: [string, keyof Kpis, boolean, "money" | "num" | "pct" | "ratio"][] = [
    ["كلفة التسويق", "cost", true, "money"], ["ليدات", "leads", false, "num"], ["مؤهَّلون", "qualified", false, "num"],
    ["حجوزات", "reservations", false, "num"], ["بيعات منسوبة", "sales", false, "num"], ["عمولة تلال", "commission", false, "money"],
    ["قيمة البيع", "sale_value", false, "money"], ["CPL", "cpl", true, "money"], ["CAC", "cac", true, "money"],
    ["ROAS", "roas", false, "ratio"], ["ROI", "roi", false, "pct"], ["ليد ← بيع", "lead_to_sale", false, "pct"],
  ];
  const show = (v: unknown, kind: string) => kind === "pct" ? fmtPct(v as number) : kind === "ratio" ? (v == null ? "—" : `${fmt(v as number)}×`) : fmt(v as number);
  const companyBudgets = budgets.data.filter((b) => b.status === "معتمدة");
  const tops: [string, BreakdownRow | undefined, string][] = [
    ["أفضل حملة", top(campaigns.data), "/dashboard/marketing/campaigns/"], ["أفضل قناة", top(channels.data), ""],
    ["أفضل مشروع", top(projects.data), "/dashboard/marketing/projects/"], ["أفضل محتوى", top(content.data, "leads"), "/dashboard/marketing/content/"],
    ["أفضل مؤثر", top(influencers.data), ""], ["أفضل صاحب حملة", top(employees.data), ""],
  ];

  return (
    <>
      <PageHead title="اللوحة التنفيذية" sub={`${from} ← ${to} مقابل ${prev.from} ← ${prev.to} · إسناد: ${ATTRIBUTION_MODELS[f.model]}`} />
      <MktFilterBar basePath="/dashboard/marketing/executive" f={f} showModel />
      {!k && <Unavailable error="تعذّر حساب المؤشّرات" />}

      {k && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {rowsCmp.map(([label, key, lower, kind]) => (
            <div key={key} className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xl font-bold tabular-nums text-gray-800">{show(k[key], kind)}</p>
              <p className="text-sm text-gray-600">{label}</p>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                <span>قبلها {show(before?.[key], kind)}</span>{delta(k[key] as number, before?.[key] as number, lower)}
              </p>
            </div>
          ))}
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tops.map(([label, r, href]) => (
          <div key={label} className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
            <p className="text-xs text-gray-500">{label}</p>
            {r ? (
              <>
                {href ? <Link href={`${href}${r.dim_key}`} className="block truncate font-semibold text-brand-700 hover:underline">{r.label}</Link>
                  : <p className="truncate font-semibold text-brand-700">{r.label}</p>}
                <p className="text-xs text-gray-600">عمولة {fmt(r.commission)} · ليدات {fmt(r.leads)}{r.roi != null ? ` · ROI ${fmtPct(r.roi)}` : ""}</p>
              </>
            ) : <p className="text-sm text-gray-400">—</p>}
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="الكلفة شهرياً (سنة)"><Columns points={trend.data.map((t) => ({ key: t.period, label: t.period.slice(0, 7), value: Number(t.cost) }))} unit="د.ع" /></Card>
        <Card title="العمولة المنسوبة شهرياً (سنة)"><Columns points={trend.data.map((t) => ({ key: t.period, label: t.period.slice(0, 7), value: Number(t.commission) }))} unit="د.ع" /></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="استهلاك الميزانيات الجارية">
          {companyBudgets.length === 0 ? <p className="text-sm text-gray-400">لا ميزانية معتمدة تشمل اليوم. <Link href="/dashboard/marketing/budget" className="text-brand-600">أنشئها</Link>.</p> : (
            <ul className="space-y-2 text-sm">
              {companyBudgets.map((b) => (
                <li key={b.budget_id}>
                  <div className="flex justify-between text-xs"><span>{b.name} <span className="text-gray-400">({b.scope_label})</span></span><span>{fmtPct(b.utilization_pct)}</span></div>
                  <div className="h-2 rounded bg-gray-100"><div className={`h-2 rounded-e ${b.alert_level === "تجاوز" ? "bg-red-500" : b.alert_level ? "bg-amber-500" : "bg-brand-500"}`} style={{ width: `${Math.min(100, Number(b.utilization_pct ?? 0))}%` }} /></div>
                  <p className="text-xs text-gray-400">مصروف {fmt(b.spent)} · ملتزم {fmt(b.committed)} · متبقٍّ {fmt(b.remaining)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="الأداء مقابل الهدف — الخطط المعتمدة الجارية">
          {progress.length === 0 ? <p className="text-sm text-gray-400">لا خطة معتمدة تشمل اليوم.</p> : progress.map(({ plan, rows }) => (
            <div key={plan.id} className="mb-3">
              <Link href={`/dashboard/marketing/plans/${plan.id}`} className="text-sm font-semibold hover:text-brand-600">{plan.title}</Link>
              <ul className="mt-1 space-y-1 text-xs">
                {rows.filter((o) => o.metric_code).map((o) => (
                  <li key={o.objective_id} className="flex justify-between gap-2">
                    <span>{o.title} <span className="text-gray-400">({METRIC_LABELS[o.metric_code!]})</span></span>
                    <span className={o.on_track ? "text-brand-700" : "text-amber-700"}>{fmt(o.actual)} / {fmt(o.target_value)} · {fmtPct(o.progress_pct)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      </div>

      <Card title="التنبؤ — الأشهر الثلاثة القادمة" actions={
        <form method="get" className="flex items-center gap-2 text-xs">
          {Object.entries(f.params).map(([kk, v]) => <input key={kk} type="hidden" name={kk} value={v} />)}
          <label>ميزانية شهرية <input name="budget" defaultValue={budget || ""} dir="ltr" className="w-28 rounded border px-2 py-1" /></label>
          <button className="rounded border px-2 py-1">احسب</button>
        </form>}>
        {!forecast ? <p className="text-sm text-gray-400">لا كلفة مسجّلة في الأشهر الأخيرة — اكتب ميزانية شهرية.</p>
          : !forecast.data?.ok ? <p className="text-sm text-amber-800">{forecast.data?.reason ?? forecast.error}</p> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500"><tr>{["السيناريو", "الكلفة", "ليدات", "مؤهَّلون", "حجوزات", "بيعات", "عمولة", "ROI"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {forecast.data.scenarios!.map((s) => (
                    <tr key={s.scenario}><td className="px-3 py-2 font-medium">{s.scenario}</td><td className="px-3 py-2">{fmt(s.cost)}</td><td className="px-3 py-2">{fmt(s.leads)}</td>
                      <td className="px-3 py-2">{fmt(s.qualified)}</td><td className="px-3 py-2">{fmt(s.reservations)}</td><td className="px-3 py-2">{fmt(s.sales)}</td>
                      <td className="px-3 py-2">{fmt(s.commission)}</td><td className="px-3 py-2">{fmtPct(s.roi)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              الأساس (آخر ١٨٠ يوماً): كلفة الليد {fmt(forecast.data.basis.cpl as number)} · ليد←مؤهَّل {fmtPct(forecast.data.basis.lead_to_qualified as number)} · ليد←بيع {fmtPct(forecast.data.basis.lead_to_sale as number)} · عمولة البيعة {fmt(forecast.data.basis.commission_per_sale as number)}.
              المتحفّظ: كلفة +٢٠٪ ونِسب −٢٠٪؛ الطموح: كلفة −١٥٪ ونِسب +٢٠٪. نِسبٌ تاريخية صريحة — لا نموذج تعلّم.
            </p>
          </>
        )}
      </Card>
    </>
  );
}
