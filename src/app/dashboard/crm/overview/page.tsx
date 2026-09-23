import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import {
  getCrmKpis,
  getFunnel,
  getDistributionAlerts,
  getForecast,
  getDataQuality,
  getSlaSummary,
  SEVERITY_STYLE,
  fmt,
} from "@/lib/crm";
import CrmTabs from "../crm-tabs";
import CrmFilterBar from "@/components/crm-filter-bar";
import { parseCrmFilters, type CrmSearchParams } from "@/lib/crm-filters";

// ============================================================
// «نظرة» — لوحة الإدارة.
//
// مبنيّة على سؤال واحد يتفرّع أربعاً، بهذا الترتيب لا غيره (§60):
//
//     ما الذي يحتاج انتباهاً؟   ← التنبيهات وخروق الخدمة أولاً
//     ماذا يحدث؟               ← المؤشّرات
//     لماذا؟                   ← القمع: أين يعلق الخطّ
//     ماذا أفعل؟               ← روابط الفعل
//
// وليست حائط بطاقات. ثمانية أرقام فقط في الصفّ الأول، وكل رقم
// رابطٌ إلى قائمته (§45): «٦٢ مهملاً» يُفتح فيعرض الاثنين والستين.
// رقمٌ لا يُنقر رقمٌ للزينة.
// ============================================================
export default async function CrmOverviewPage({
  searchParams,
}: {
  searchParams: CrmSearchParams;
}) {
  const role = await getUserRole();
  const READERS = ["admin", "followup_manager", "supervisor", "marketing", "viewer"];
  if (!READERS.includes(role)) {
    redirect("/dashboard/crm/today");
  }

  // نفس مفردات التقارير: الانتقال بينهما لا يُسقط المُرشِّح (§44)
  const parsed = await parseCrmFilters(searchParams);
  const f = parsed.filters;

  const [kpis, funnel, alerts, forecast, dq, sla] = await Promise.all([
    getCrmKpis(f),
    getFunnel(f),
    getDistributionAlerts(),
    getForecast(3),
    getDataQuality(),
    getSlaSummary(),
  ]);

  const highDq = dq.filter((d) => d.severity === "عالٍ");
  const openBreaches = sla.reduce((s, r) => s + Number(r.still_open), 0);
  const thisMonth = forecast[0] ?? null;
  const maxReached = Math.max(1, ...funnel.map((f) => Number(f.reached)));

  return (
    <div>
      <CrmTabs active="overview" />

      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-xl font-bold text-brand-600">نظرة</h1>
          <p className="mt-1 text-sm text-gray-500">ما يحتاج انتباهاً، ثم ما يحدث، ثم لماذا.</p>
        </header>

        <CrmFilterBar basePath="/dashboard/crm/overview" parsed={parsed} />

        {/* ===== ١) ما يحتاج انتباهاً ===== */}
        {(alerts.length > 0 || highDq.length > 0 || openBreaches > 0) && (
          <section className="space-y-2">
            {alerts.slice(0, 3).map((a, i) => (
              <Link
                key={`${a.code}-${i}`}
                href="/dashboard/crm/distribution"
                className={`block rounded-lg border p-3 text-sm transition hover:opacity-90 ${
                  SEVERITY_STYLE[a.severity]
                }`}
              >
                <b>{a.title}:</b> {a.detail}
              </Link>
            ))}
            {openBreaches > 0 && (
              <Link
                href="/dashboard/crm/reports#sla"
                className={`block rounded-lg border p-3 text-sm ${SEVERITY_STYLE["متوسط"]}`}
              >
                <b>{openBreaches} خرقاً مفتوحاً لمستوى الخدمة</b> — تفصيلها في التقارير.
              </Link>
            )}
            {highDq.length > 0 && (
              <Link
                href="/dashboard/crm/data-quality"
                className={`block rounded-lg border p-3 text-sm ${SEVERITY_STYLE["متوسط"]}`}
              >
                <b>{highDq.length} ملاحظة عالية على جودة البيانات</b> — كلٌّ منها تُفسد رقماً هنا.
              </Link>
            )}
          </section>
        )}

        {/* ===== ٢) ما يحدث ===== */}
        {kpis ? (
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="فرص مفتوحة" value={fmt(kpis.open_count)} href="/dashboard/crm/opportunities?type=open" />
            <Kpi label="قيمة الأنابيب" value={fmt(kpis.pipeline_value)} sub={`موزونة ${fmt(kpis.weighted_pipeline)}`} href="/dashboard/crm/opportunities?type=open" />
            <Kpi label="معدّل التحويل" value={`${kpis.conversion_rate}%`} sub={`${kpis.won_count} فوز · ${kpis.lost_count} خسارة`} href="/dashboard/crm/reports" />
            <Kpi label="دورة البيع" value={`${kpis.avg_sales_cycle} يوماً`} sub={`الوسيط ${kpis.median_sales_cycle}`} href="/dashboard/crm/reports" />
            <Kpi label="متأخرة" value={fmt(kpis.overdue_count)} tone="red" href="/dashboard/crm/today" />
            <Kpi label="مهملة" value={fmt(kpis.neglected_count)} tone="red" href="/dashboard/crm/distribution" />
            <Kpi label="ساخنة" value={fmt(kpis.hot_count)} tone="brand" href="/dashboard/clients?temperature=ساخن" />
            <Kpi label="ليدات" value={fmt(kpis.leads)} sub={`${fmt(kpis.activities)} تواصلاً`} href="/dashboard/clients" />
          </section>
        ) : (
          <Unavailable what="المؤشّرات" />
        )}

        {/* ===== ٣) لماذا — القمع ===== */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="font-bold text-gray-800">أين يعلق الخطّ</h2>
            {funnel.length === 0 ? (
              <Unavailable what="القمع" inline />
            ) : (
              <ul className="mt-4 space-y-3">
                {funnel.map((f) => (
                  <li key={f.stage_name}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium text-gray-700">{f.stage_name}</span>
                      <span className="text-gray-500">
                        {f.reached} ({f.reached_pct}%)
                        {f.step_conversion !== null && (
                          <span className={Number(f.drop_off_pct) >= 50 ? "ms-2 text-red-600" : "ms-2 text-gray-400"}>
                            تسرّب {f.drop_off_pct}%
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded bg-gray-100">
                      <div
                        className="h-2 rounded bg-brand-500"
                        style={{ width: `${(Number(f.reached) / maxReached) * 100}%` }}
                      />
                    </div>
                    {f.median_days !== null && (
                      <p className="mt-0.5 text-xs text-gray-400">وسيط البقاء {f.median_days} يوماً</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* التنبؤ للشهر — ثلاثة أرقام لا رقم */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-bold text-gray-800">هذا الشهر</h2>
              <Link href="/dashboard/crm/forecast" className="text-xs text-brand-600 hover:underline">
                التنبؤ الكامل
              </Link>
            </div>
            {thisMonth ? (
              <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-brand-50 p-3">
                  <dt className="text-xs text-gray-500">مُغلق</dt>
                  <dd className="mt-1 text-lg font-bold text-brand-700">{fmt(thisMonth.closed_value)}</dd>
                  <dd className="text-xs text-gray-400">{thisMonth.closed_count} صفقة</dd>
                </div>
                <div className="rounded-lg bg-amber-50 p-3">
                  <dt className="text-xs text-gray-500">ملتزم</dt>
                  <dd className="mt-1 text-lg font-bold text-amber-700">{fmt(thisMonth.commit_value)}</dd>
                  <dd className="text-xs text-gray-400">{thisMonth.commit_count} فرصة ≥٧٠%</dd>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <dt className="text-xs text-gray-500">أفضل حالة</dt>
                  <dd className="mt-1 text-lg font-bold text-gray-700">{fmt(thisMonth.best_case_value)}</dd>
                  <dd className="text-xs text-gray-400">{thisMonth.open_count} مفتوحة</dd>
                </div>
              </dl>
            ) : (
              <Unavailable what="التنبؤ" inline />
            )}
            {thisMonth && Number(thisMonth.undated_count) > 0 && (
              <p className="mt-3 text-xs text-gray-500">
                {thisMonth.undated_count} فرصة بلا تاريخ إغلاق متوقَّع — نُسبت لهذا الشهر تقديراً.
              </p>
            )}
          </div>
        </section>

        {/* ===== ٤) ماذا أفعل ===== */}
        <section className="flex flex-wrap gap-2">
          <Action href="/dashboard/crm/distribution" label="مركز التوزيع" />
          <Action href="/dashboard/crm/opportunities" label="الفرص" />
          <Action href="/dashboard/crm/reports" label="التقارير" />
          <Action href="/dashboard/crm/forecast" label="الأهداف والتنبؤ" />
          <Action href="/dashboard/crm/data-quality" label="جودة البيانات" />
          {role === "admin" && <Action href="/dashboard/settings/crm" label="إعدادات الـCRM" />}
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label, value, sub, href, tone,
}: { label: string; value: string; sub?: string; href: string; tone?: "red" | "brand" }) {
  const v = tone === "red" ? "text-red-700" : tone === "brand" ? "text-brand-700" : "text-gray-800";
  return (
    <Link href={href} className="rounded-lg border border-gray-200 bg-white p-4 transition hover:border-brand-300">
      <p className={`text-2xl font-bold ${v}`}>{value}</p>
      <p className="text-sm text-gray-600">{label}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </Link>
  );
}

function Action({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition hover:border-brand-600 hover:text-brand-600">
      {label}
    </Link>
  );
}

// «غير متاح» ≠ «فارغ». الشاشة تفرّق بينهما ولا تقول «لا بيانات» وهي لا تعرف.
function Unavailable({ what, inline }: { what: string; inline?: boolean }) {
  return (
    <p className={`${inline ? "mt-4" : ""} rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-400`}>
      {what} غير متاحة — تأكّد من تشغيل الهجرات ٠٧٠–٠٨٠.
    </p>
  );
}
