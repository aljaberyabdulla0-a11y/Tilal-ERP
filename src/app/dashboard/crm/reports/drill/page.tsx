import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import { baghdadDate, baghdadTime } from "@/lib/time";
import {
  DIM_LABELS, applyTemplateScope, dimValueLabel, filterSummary, getDimLabels, getMetricDefs, getReportDrilldown,
  getReportTemplate, getWeekStartDow, REPORT_ROLES,
} from "@/lib/crm-reporting";
import { parseReportParams, queryString, toEngineFilters, toQuery, type DateBasis, type RawSearchParams } from "@/lib/report-filters";
import { bucketLabel, type CompareMode, type RangePreset } from "@/lib/report-dates";
import { fmtNum } from "@/lib/report-engine";
import CrmTabs from "../../crm-tabs";

// ============================================================
// «اعرض الصفوف خلف الرقم» (§38 · §50).
//
// نفس شرط المقياس من crm_metrics، ونفس المُرشِّحات، ونفس المدى، ومعها
// قيم أبعاد الخلية المنقورة — فالعدد هنا هو الرقم هناك. والنسبة تنزل
// إلى مقامها: «التحويل ٢٪» يفتح كل الصفقات المغلقة لا الفائزة وحدها.
//
// RLS تحكم الصفوف كما حكمت الرقم، والتقنيع (092) يسري على الأسماء.
// ============================================================

const PAGE = 50;

export default async function Drill({ searchParams }: { searchParams: RawSearchParams & { metric?: string; cell?: string; state?: string; page?: string; template?: string } }) {
  const role = await getUserRole();
  if (!REPORT_ROLES.includes(role)) redirect("/dashboard");

  const metricCode = typeof searchParams.metric === "string" ? searchParams.metric : "";
  const [defs, labels, weekStartDow] = await Promise.all([getMetricDefs(), getDimLabels(), getWeekStartDow()]);
  const metric = defs.find((m) => m.code === metricCode);
  if (!metric) redirect("/dashboard/crm/reports");

  const template = typeof searchParams.template === "string" ? await getReportTemplate(searchParams.template) : null;
  const defaults = template ? {
    preset: (template.definition.default_range ?? "last_7") as RangePreset,
    compare: (template.definition.compare ?? "previous_period") as CompareMode,
    basis: (template.definition.basis ?? "event") as DateBasis,
  } : { preset: "last_7" as RangePreset };

  const today = baghdadDate();
  const params = applyTemplateScope(parseReportParams(searchParams, { today, weekStartDow, defaults }), template);
  let cell: Record<string, string | null> = {};
  try {
    const parsed = typeof searchParams.cell === "string" ? JSON.parse(searchParams.cell) : {};
    if (parsed && typeof parsed === "object") cell = parsed;
  } catch { /* خلية تالفة = بلا تجزئة */ }
  const state = searchParams.state === "current" ? "current" : "snapshot";
  const page = Math.max(1, Number(searchParams.page) || 1);

  const res = await getReportDrilldown({
    metric: metric!.code, range: params.range, filters: toEngineFilters(params), dims: cell,
    basis: params.basis, state, limit: PAGE, offset: (page - 1) * PAGE,
  });
  const pages = Math.max(1, Math.ceil(res.total / PAGE));
  const isEvents = metric!.source === "events";
  const base: Record<string, string> = {
    ...toQuery(params, defaults), metric: metric!.code,
    ...(Object.keys(cell).length ? { cell: JSON.stringify(cell) } : {}),
    ...(searchParams.state ? { state } : {}),
    ...(template ? { template: template.code ?? template.id } : {}),
  };
  const back = template
    ? `/dashboard/crm/reports/view${queryString({ template: template.code ?? template.id, ...toQuery(params, defaults) })}`
    : `/dashboard/crm/reports${queryString(toQuery(params, defaults))}`;
  const name = (dim: string, v: unknown) => dimValueLabel(dim, (v as string | null) ?? null, labels);

  return (
    <div>
      <CrmTabs active="reports" />
      <div className="space-y-4 p-6">
        <Link href={back} className="text-sm text-brand-700 hover:underline">← العودة إلى التقرير</Link>
        <header className="rounded-lg border border-gray-200 bg-white p-5">
          <h1 className="text-lg font-bold text-gray-800">
            {metric!.name_ar}: <span className="tabular-nums text-brand-700">{fmtNum(res.total)}</span> {isEvents ? "حدثاً" : "صفّاً"}
          </h1>
          <p className="mt-1 text-sm text-gray-600">{metric!.definition}</p>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-gray-600 sm:grid-cols-2">
            <div><dt className="inline text-gray-400">الصيغة: </dt><dd className="inline">{metric!.formula}</dd></div>
            <div><dt className="inline text-gray-400">التاريخ: </dt><dd className="inline">{metric!.date_field}</dd></div>
            <div><dt className="inline text-gray-400">المدى: </dt><dd className="inline">{params.range.from} ← {params.range.to}{!isEvents && ` · ${state === "current" ? "الحالة الآن" : "لقطة نهاية المدى"}`}</dd></div>
            <div><dt className="inline text-gray-400">المُرشِّحات: </dt><dd className="inline">{filterSummary(params, labels)}</dd></div>
            {Object.entries(cell).map(([k, v]) => (
              <div key={k}>
                <dt className="inline text-gray-400">{DIM_LABELS[k] ?? k}: </dt>
                <dd className="inline font-medium">{k === "day" || k === "week" || k === "month" ? bucketLabel(k, v ?? "") : name(k, v)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex gap-2 text-sm">
            <a href={`/api/crm/reports/export${queryString({ ...base, format: "csv", drill: "1" })}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">تصدير CSV</a>
          </div>
        </header>

        {res.error ? (
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">تعذّر النزول: {res.error}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                {isEvents ? (
                  <tr>{["الوقت (بغداد)", "الحدث", "العميل", "الموظف", "المشروع", "المصدر", "النتيجة / المرحلة", "القيمة", "ملخّص"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
                ) : (
                  <tr>{["اللقطة", "العميل", "المالك", "المشروع", "المرحلة", "الخطوة القادمة", "صامت (يوم)", "الحرارة", "القيمة"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
                )}
              </thead>
              <tbody className="divide-y divide-gray-100">
                {res.rows.map((r, i) => isEvents ? (
                  <tr key={String(r.event_id ?? i)} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600">{baghdadDate(String(r.event_at))} {baghdadTime(String(r.event_at))}</td>
                    <td className="px-3 py-2">
                      {String(r.activity_type ?? r.event_subtype ?? r.event_type)}
                      {r.is_synthetic ? <span className="ms-1 text-[11px] text-amber-700" title="حدث مركَّب من تاريخ الإغلاق — لا صفّ له في تاريخ المراحل">مركَّب</span> : null}
                    </td>
                    <td className="px-3 py-2">{r.client_id ? <Link href={`/dashboard/clients/${r.client_id}`} className="text-brand-700 hover:underline">{String(r.client_name ?? "—")}</Link> : "—"}</td>
                    <td className="px-3 py-2">{name("employee", r.employee_id)}</td>
                    <td className="px-3 py-2">{name("project", r.project_id)}</td>
                    <td className="px-3 py-2">{name("source", r.source_id)}</td>
                    <td className="px-3 py-2 text-gray-600">{r.to_stage ? `${r.from_stage ?? "—"} ← ${r.to_stage}` : String(r.result ?? "—")}</td>
                    <td className="px-3 py-2 tabular-nums">{r.value === null || r.value === undefined ? "—" : fmtNum(Number(r.value))}</td>
                    <td className="max-w-xs truncate px-3 py-2 text-xs text-gray-500" title={String(r.summary ?? "")}>{String(r.summary ?? "")}</td>
                  </tr>
                ) : (
                  <tr key={`${String(r.client_id)}-${String(r.opportunity_id)}-${i}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 tabular-nums text-gray-600">{String(r.snapshot_date)}</td>
                    <td className="px-3 py-2"><Link href={`/dashboard/clients/${r.client_id}`} className="text-brand-700 hover:underline">{String(r.client_name ?? "—")}</Link></td>
                    <td className="px-3 py-2">{name("employee", r.owner_id)}</td>
                    <td className="px-3 py-2">{name("project", r.project_id)}</td>
                    <td className="px-3 py-2">{String(r.stage_name ?? "—")}{r.stage_estimated ? <span className="ms-1 text-[11px] text-amber-700" title="لا حدث مرحلة قبل هذا اليوم — المرحلة تقدير">تقدير</span> : null}</td>
                    <td className="px-3 py-2 tabular-nums">{String(r.next_action_date ?? "—")}</td>
                    <td className="px-3 py-2 tabular-nums">{r.days_silent === null || r.days_silent === undefined ? "لم يُتواصل" : String(r.days_silent)}</td>
                    <td className="px-3 py-2">{String(r.temperature ?? "—")}</td>
                    <td className="px-3 py-2 tabular-nums">{r.expected_value === null || r.expected_value === undefined ? "—" : fmtNum(Number(r.expected_value))}</td>
                  </tr>
                ))}
                {res.rows.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">لا صفوف.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <nav className="flex items-center justify-center gap-3 text-sm">
            {page > 1 && <Link href={`/dashboard/crm/reports/drill${queryString({ ...base, page: String(page - 1) })}`} className="rounded border px-3 py-1 hover:bg-gray-50">السابق</Link>}
            <span className="text-gray-500">صفحة {page} من {pages} · {fmtNum(res.total)} صفّاً</span>
            {page < pages && <Link href={`/dashboard/crm/reports/drill${queryString({ ...base, page: String(page + 1) })}`} className="rounded border px-3 py-1 hover:bg-gray-50">التالي</Link>}
          </nav>
        )}
      </div>
    </div>
  );
}
