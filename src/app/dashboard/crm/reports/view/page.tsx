import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getUserRole } from "@/lib/auth";
import { baghdadDate, baghdadTime } from "@/lib/time";
import { getSavedViews } from "@/lib/crm";
import {
  applyTemplateScope, filterSummary, fixedFiltersOf, generateReport, getDimLabels, getReportRun, getReportTemplate, getWeekStartDow, logReportRun,
  BUILDER_ROLES, MANAGE_ROLES, REPORT_ROLES,
} from "@/lib/crm-reporting";
import {
  BASIS_LABELS, parseReportParams, queryString, reportBrand, toQuery, type DateBasis, type RawSearchParams,
} from "@/lib/report-filters";
import { COMPARE_LABELS, type CompareMode, type RangePreset } from "@/lib/report-dates";
import ReportFilterBar from "@/components/reports/report-filter-bar";
import ReportSections from "@/components/reports/report-sections";
import PrintOnLoad from "@/components/reports/print-on-load";
import SavedViews, { type SavedView } from "@/components/saved-views";
import CrmTabs from "../../crm-tabs";

// ============================================================
// فتح تقرير (§39 · §42 · §78).
//
//   ?template=<رمز أو معرّف>&<مُرشِّحات>   تقرير من قالب بمُرشِّحاته
//   ?run=<معرّف تشغيل>                      تشغيل محفوظ — من تقرير مجدول
//                                          غالباً: مداه ومُرشِّحاته كما
//                                          حُسمت يوم الإرسال، وأرقامه
//                                          بصلاحية من يفتحه الآن
//   &print=1                               للطباعة وحفظ PDF
//
// كل فتحٍ «توليد» يُسجَّل في سجلّ التشغيل (§40): من، متى، أيّ مدى
// ومُرشِّحات، كم صفّاً، كم استغرق، وآخر لقطة كانت متاحة.
// ============================================================

// عنوان الصفحة — يطبعه المتصفّح في رأس الـPDF: اسم المشروع لا «تلال ERP»
export async function generateMetadata({ searchParams }: { searchParams: RawSearchParams & { template?: string; run?: string } }) {
  let ref = typeof searchParams.template === "string" ? searchParams.template : null;
  let sp: RawSearchParams = searchParams;
  if (typeof searchParams.run === "string") {
    const run = await getReportRun(searchParams.run);
    ref = run?.template_id ?? run?.template_code ?? null;
    sp = { ...((run?.params as { filters?: Record<string, string[]> } | undefined)?.filters ?? {}) };
    for (const [k, v] of Object.entries(sp)) if (Array.isArray(v)) sp[k] = v.join(",");
  }
  const template = ref ? await getReportTemplate(ref) : null;
  if (!template) return { title: "التقارير" };
  const params = applyTemplateScope(parseReportParams(sp, { today: baghdadDate() }), template);
  const labels = await getDimLabels();
  const brand = reportBrand(params.filters, (id) => labels.project.get(id));
  return { title: `${template.name} · ${brand.name}` };
}

export default async function ViewReport({ searchParams }: { searchParams: RawSearchParams & { template?: string; run?: string; print?: string } }) {
  const role = await getUserRole();
  if (!REPORT_ROLES.includes(role)) redirect("/dashboard");

  let sp: RawSearchParams = searchParams;
  let templateRef = typeof searchParams.template === "string" ? searchParams.template : null;
  let fromRun: Awaited<ReturnType<typeof getReportRun>> = null;

  if (typeof searchParams.run === "string") {
    fromRun = await getReportRun(searchParams.run);
    if (!fromRun) return <Missing text="التشغيل غير موجود أو ليس لك." />;
    templateRef = fromRun.template_id ?? fromRun.template_code;
    const p = fromRun.params as { compare?: string; basis?: string; filters?: Record<string, unknown> };
    sp = { from: fromRun.date_from ?? undefined, to: fromRun.date_to ?? undefined, compare: p.compare, basis: p.basis };
    for (const [k, v] of Object.entries(p.filters ?? {})) sp[k] = Array.isArray(v) ? v.map(String).join(",") : String(v);
  }

  if (!templateRef) redirect("/dashboard/crm/reports");
  const template = await getReportTemplate(templateRef);
  if (!template) return <Missing text="القالب غير موجود أو ليس لدورك." />;
  if (template.definition.link) redirect(template.definition.link);

  const [user, weekStartDow, views] = await Promise.all([getCurrentUser(), getWeekStartDow(), getSavedViews("reports")]);
  const today = baghdadDate();
  const defaults = {
    preset: (template.definition.default_range ?? "last_7") as RangePreset,
    compare: (template.definition.compare ?? "previous_period") as CompareMode,
    basis: (template.definition.basis ?? "event") as DateBasis,
  };
  const params = applyTemplateScope(parseReportParams(sp, { today, weekStartDow, defaults }), template);
  const fixed = fixedFiltersOf(template);
  const report = await generateReport(template, params, today, weekStartDow);

  if (!fromRun) {
    await logReportRun({
      templateId: template.id, name: template.name, trigger: "manual",
      format: searchParams.print === "1" ? "pdf" : "view",
      params: { preset: params.preset, compare: params.compare, basis: params.basis, filters: params.filters },
      range: params.range, rows: report.rows, durationMs: report.durationMs, errors: report.errors,
    });
  }

  const print = searchParams.print === "1";
  // اسم المشروع يحلّ محلّ اسم الشركة حين يكون التقرير لمشروع (§ تقرير المشروع)
  const brand = reportBrand(params.filters, (id) => report.labels.project.get(id));
  const q = { template: template.code ?? template.id, ...toQuery(params, defaults) };
  const exportQ = { template: template.code ?? template.id, ...toQuery(params) };
  const manages = MANAGE_ROLES.includes(role);

  return (
    <div className={print ? "bg-white" : ""}>
      {!print && <div className="print:hidden"><CrmTabs active="reports" /></div>}
      {print && <PrintOnLoad />}
      <div className="space-y-5 p-6 print:p-0">
        {/* الرأس (§39) — ما يلزم ليُفهم الرقم بعد سنة */}
        <header className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={brand.scoped ? "text-sm font-semibold text-brand-800" : "text-xs text-gray-500"}>{brand.name} · تقارير المبيعات</p>
              <h1 className="mt-1 text-xl font-bold text-brand-700">{template.name}</h1>
              {template.description && <p className="mt-1 max-w-3xl text-sm text-gray-500">{template.description}</p>}
            </div>
            {!print && (
              <div className="flex flex-wrap items-center gap-2 text-sm print:hidden">
                <Link href={`/dashboard/crm/reports/view${queryString(q)}`} className="rounded-lg bg-brand-600 px-3 py-1.5 font-semibold text-white hover:bg-brand-700">توليد من جديد</Link>
                <a href={`/api/crm/reports/export${queryString({ ...exportQ, format: "xlsx" })}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">Excel</a>
                <a href={`/api/crm/reports/export${queryString({ ...exportQ, format: "csv" })}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">CSV</a>
                <a href={`/dashboard/crm/reports/view${queryString({ ...q, print: "1" })}`} target="_blank" className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">PDF</a>
                {BUILDER_ROLES.includes(role) && (
                  <Link href={`/dashboard/crm/reports/builder?from=${template.id}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">
                    {template.is_system || template.created_by !== user?.id ? "نسخ وتعديل" : "تعديل"}
                  </Link>
                )}
                {(manages || role === "supervisor") && (
                  <Link href={`/dashboard/crm/reports/schedules?template=${template.id}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">جدولة</Link>
                )}
                {manages && <Link href="/dashboard/crm/reports/snapshots" className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">اللقطات</Link>}
              </div>
            )}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-4">
            <Meta k="المدى" v={`${params.range.label} (${params.range.from} ← ${params.range.to})`} />
            <Meta k="المقارنة" v={params.compareRange ? `${COMPARE_LABELS[params.compare]}: ${params.compareRange.from} ← ${params.compareRange.to}` : "—"} />
            <Meta k="أساس التاريخ" v={BASIS_LABELS[params.basis]} />
            <Meta k="وُلِّد" v={`${baghdadDate(report.generatedAt)} ${baghdadTime(report.generatedAt)}`} />
            <Meta k="المنطقة الزمنية" v="Asia/Baghdad (UTC+3)" />
            <Meta k="المصدر" v="أحداث crm_event_facts + لقطات crm_snapshot_rows" />
            <Meta k="آخر لقطة" v={report.lastSnapshot ?? "لا لقطات"} />
            <Meta k="النسخة" v={`قالب v${template.version} · محرّك 1`} />
            <Meta k="المُرشِّحات" v={filterSummary(params, report.labels)} wide />
            {fromRun && <Meta k="التشغيل" v={`${fromRun.requested_by_name ?? ""} · ${baghdadDate(fromRun.started_at)} — الأرقام بصلاحيتك أنت`} wide />}
          </dl>
          {report.errors.length > 0 && (
            <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
              {report.errors.length} قسم تعذّر حسابه — يظهر مكانه خطؤه لا رقم بديل. سُجِّل التشغيل «فشل».
            </p>
          )}
        </header>

        {!print && (
          <>
            <ReportFilterBar basePath="/dashboard/crm/reports/view" params={params} defaults={defaults}
                             extra={{ template: template.code ?? template.id }} locked={fixed} />
            <SavedViews entity="reports" basePath="/dashboard/crm/reports/view"
                        current={q} views={(views as SavedView[]).filter((v) => v.filters?.template === q.template)} userId={user?.id ?? null} />
          </>
        )}

        <ReportSections report={report} today={today} print={print} />

        <footer className="pt-2 text-center text-[11px] text-gray-400">
          {brand.name} · {template.name} · وُلِّد {baghdadDate(report.generatedAt)} {baghdadTime(report.generatedAt)} بتوقيت بغداد · {report.durationMs}ms
        </footer>
      </div>
    </div>
  );
}

function Meta({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 sm:col-span-3 lg:col-span-4" : ""}>
      <dt className="text-gray-400">{k}</dt>
      <dd className="text-gray-700">{v}</dd>
    </div>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <div className="p-10 text-center">
      <p className="text-gray-600">{text}</p>
      <Link href="/dashboard/crm/reports" className="mt-3 inline-block text-brand-700 hover:underline">العودة إلى التقارير</Link>
    </div>
  );
}
