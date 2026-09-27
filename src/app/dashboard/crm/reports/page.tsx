import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getUserRole } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { getSavedViews } from "@/lib/crm";
import {
  generateReport, getReportTemplates, getSnapshotStatus, getWeekStartDow,
  MANAGE_ROLES, BUILDER_ROLES, REPORT_ROLES, type ReportTemplate,
} from "@/lib/crm-reporting";
import { parseReportParams, toQuery, type RawSearchParams } from "@/lib/report-filters";
import ReportFilterBar from "@/components/reports/report-filter-bar";
import ReportSections from "@/components/reports/report-sections";
import SavedViews, { type SavedView } from "@/components/saved-views";
import CrmTabs from "../crm-tabs";

// ============================================================
// التقارير — لوحة المحرّك (096–099) ومعرض قوالبه.
//
// ===== ترتيب القراءة (§87) =====
//
//   ١) ماذا حدث؟           المؤشّرات مع المقارنة
//   ٢) كيف تغيّر؟           الاتجاه يوماً بيوم
//   ٣) أين؟                 الأنابيب، المشاريع، المصادر
//   ٤) من؟                  الفريق
//   ٥) لماذا؟               المتابعة والمخاطر والملاحظات
//   ٦) التفاصيل             كل رقم رابطٌ إلى صفوفه
//
// واللوحة تعريفٌ بنفس شكل القوالب (أقسام × مقاييس × أبعاد) — تُحسب
// بنفس المحرّك، فلا يختلف رقمها عن رقم القالب المفتوح بنفس المُرشِّحات.
//
// ===== من يرى ماذا (§71) =====
//
// الموظف يدخل الآن (كان ممنوعاً): RLS على الأحداث واللقطات تعطيه
// نشاطه وليداته وحدها — «تقاريري». المشرف فريقه، والإدارة الكل.
// المحاسب يرى قوالب الإيراد وحدها (لوحة النشاط أصفارٌ عنده بالتعريف،
// فلا تُعرض عليه لوحةٌ تبدو كأن الشركة متوقّفة).
// ============================================================

const DASHBOARD: ReportTemplate = {
  id: "dashboard",
  code: null,
  name: "لوحة التقارير",
  description: null,
  category: "لوحة",
  audience: REPORT_ROLES,
  is_system: true,
  is_shared: true,
  version: 1,
  created_by: null,
  updated_at: "",
  sort_order: 0,
  definition: {
    sections: [
      { key: "row1", title: "ماذا حدث", type: "kpis",
        metrics: ["NEW_LEADS", "TOTAL_ACTIVITIES", "UNIQUE_CLIENTS_CONTACTED", "QUALIFIED_LEADS", "NEW_OPPORTUNITIES", "RESERVATIONS", "WON_DEALS", "REVENUE"] },
      { key: "trend", title: "يوماً بيوم", type: "trend", metrics: ["NEW_LEADS", "TOTAL_ACTIVITIES", "CALLS", "VISITS", "QUALIFIED_LEADS", "WON_DEALS"], group_by: ["day"] },
      { key: "pipeline", title: "الأنابيب في نهاية المدة", type: "kpis",
        metrics: ["OPEN_OPPORTUNITIES", "AT_CONTACTED", "AT_VISIT", "AT_OFFER", "ACTIVE_RESERVATIONS", "PIPELINE_VALUE", "WEIGHTED_PIPELINE"], state: "snapshot" },
      { key: "employees", title: "الفريق", type: "table",
        metrics: ["TOTAL_ACTIVITIES", "UNIQUE_CLIENTS_CONTACTED", "CALLS", "VISITS", "QUALIFIED_LEADS", "RESERVATIONS", "WON_DEALS", "OVERDUE"], group_by: ["employee"], sort: "-TOTAL_ACTIVITIES", state: "snapshot" },
      { key: "projects", title: "المشاريع", type: "table",
        metrics: ["NEW_LEADS", "TOTAL_ACTIVITIES", "VISITS", "QUALIFIED_LEADS", "RESERVATIONS", "WON_DEALS", "OPEN_OPPORTUNITIES"], group_by: ["project"], sort: "-NEW_LEADS", state: "snapshot" },
      { key: "sources", title: "المصادر", type: "table",
        metrics: ["NEW_LEADS", "UNIQUE_CLIENTS_CONTACTED", "QUALIFIED_LEADS", "WON_DEALS", "CONVERSION_RATE"], group_by: ["source"], sort: "-NEW_LEADS" },
      { key: "risk", title: "مخاطر المتابعة", type: "kpis",
        metrics: ["OVERDUE", "DUE_TODAY", "NO_NEXT_ACTION", "NO_CONTACT", "NEGLECTED", "DORMANT", "SLA_BREACH_OPEN", "UNASSIGNED"], state: "snapshot" },
      { key: "insights", title: "ما يستحق النظر", type: "insights" },
    ],
  },
};

export default async function ReportsHub({ searchParams }: { searchParams: RawSearchParams }) {
  const role = await getUserRole();
  if (!REPORT_ROLES.includes(role)) redirect("/dashboard");

  const [user, weekStartDow, templates, status, views] = await Promise.all([
    getCurrentUser(), getWeekStartDow(), getReportTemplates(), getSnapshotStatus(), getSavedViews("reports"),
  ]);
  const today = baghdadDate();
  const params = parseReportParams(searchParams, { today, weekStartDow, defaults: { preset: "last_7" } });
  const showDashboard = role !== "accountant";
  const report = showDashboard ? await generateReport(DASHBOARD, params, today, weekStartDow) : null;

  const qs = new URLSearchParams(toQuery(params)).toString();
  const manages = MANAGE_ROLES.includes(role);
  const builds = BUILDER_ROLES.includes(role);

  const byCategory = new Map<string, ReportTemplate[]>();
  for (const t of templates) {
    const k = t.is_system ? t.category : "مخصّصة";
    byCategory.set(k, [...(byCategory.get(k) ?? []), t]);
  }

  return (
    <div>
      <CrmTabs active="reports" />
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-600">{role === "employee" ? "تقاريري" : "التقارير"}</h1>
            <p className="mt-1 text-sm text-gray-500">
              من الأحداث بتاريخ وقوعها واللقطات اليومية — لا من الحالة الراهنة. كل رقم يُنقر إلى صفوفه.
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            <SnapshotChip status={status} manages={manages} />
            {builds && <Link href="/dashboard/crm/reports/builder" className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">منشئ التقارير</Link>}
            {(manages || role === "supervisor") && <Link href="/dashboard/crm/reports/schedules" className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">المجدولة</Link>}
            <Link href="/dashboard/crm/reports/history" className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">سجلّ التشغيل</Link>
            <Link href="/dashboard/crm/reports/metrics" className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50">تعريفات المقاييس</Link>
          </nav>
        </header>

        {showDashboard && (
          <>
            <ReportFilterBar basePath="/dashboard/crm/reports" params={params} defaults={{ preset: "last_7" }} />
            <SavedViews entity="reports" basePath="/dashboard/crm/reports" current={toQuery(params)}
                        views={views as SavedView[]} userId={user?.id ?? null} />
            {report && <ReportSections report={report} today={today} />}
          </>
        )}

        {/* معرض القوالب (§20) — كلٌّ يفتح بنفس المُرشِّحات الحالية */}
        <section>
          <h2 className="mb-3 font-bold text-gray-800">القوالب</h2>
          <div className="space-y-5">
            {Array.from(byCategory.entries()).map(([cat, list]) => (
              <div key={cat}>
                <p className="mb-2 text-xs font-medium text-gray-500">{cat}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((t) => {
                    const href = t.definition.link
                      ? t.definition.link
                      : `/dashboard/crm/reports/view?template=${encodeURIComponent(t.code ?? t.id)}${qs ? `&${qs}` : ""}`;
                    return (
                      <Link key={t.id} href={href} className="rounded-lg border border-gray-200 bg-white p-4 transition hover:border-brand-600">
                        <p className="font-semibold text-gray-800">{t.name}</p>
                        {t.description && <p className="mt-1 text-xs leading-5 text-gray-500">{t.description}</p>}
                        <p className="mt-2 text-[11px] text-gray-400">
                          {t.definition.link ? "شاشة قائمة" : `${t.definition.sections.length} أقسام`}
                          {!t.is_system && (t.is_shared ? " · مشترك" : " · خاصّ")}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
            {templates.length === 0 && <p className="text-sm text-gray-400">لا قوالب متاحة لدورك.</p>}
          </div>
        </section>

        {/* روابط قديمة محفوظة في القاعدة والإشعارات (075 · 077 · 083) تشير إلى
            /dashboard/crm/reports#sla و#lost — تبقى تعمل */}
        <p className="text-xs text-gray-400">
          <span id="sla" /> <span id="lost" />
          مستوى الخدمة ولماذا نخسر في{" "}
          <Link href="/dashboard/crm/reports/analysis#sla" className="text-brand-700 hover:underline">تحليل المبيعات</Link>.
        </p>
      </div>
    </div>
  );
}

function SnapshotChip({ status, manages }: { status: Awaited<ReturnType<typeof getSnapshotStatus>>; manages: boolean }) {
  if (!status) return null;
  const failed = status.last_failure && !status.last_failure.recovered;
  const label = failed
    ? `فشلت لقطة ${status.last_failure!.snapshot_date}`
    : status.last_success ? `آخر لقطة ${status.last_success.snapshot_date}` : "لا لقطات بعد";
  const cls = failed ? "border-red-300 bg-red-50 text-red-800" : status.target_done ? "border-brand-200 bg-brand-50 text-brand-800" : "border-amber-300 bg-amber-50 text-amber-900";
  const body = (
    <span className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 ${cls}`}>
      <span className="material-symbols-outlined text-[16px]">{failed ? "error" : status.target_done ? "check_circle" : "schedule"}</span>
      {label}
    </span>
  );
  return manages ? <Link href="/dashboard/crm/reports/snapshots">{body}</Link> : body;
}
