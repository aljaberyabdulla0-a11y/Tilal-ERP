import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageHr } from "@/lib/auth";
import {
  filtersQuery,
  getHrCatalog,
  getHrReport,
  hrCellText,
  parseHrFilters,
} from "@/lib/hr-reports";
import HrTabs from "../hr-tabs";
import PrintButton from "./print-button";

export const dynamic = "force-dynamic";

// تقارير HR (sql/165) — HR والمالية للكل، والمدير لفريقه وقسمه.
// ما يحقّ لكل دور تقرّره القاعدة (hr_report_catalog)، لا هذه الصفحة.
export default async function HrReportsPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const catalog = await getHrCatalog();
  const allowed = catalog.filter((c) => c.allowed);
  if (allowed.length === 0) redirect("/dashboard/me");

  const f = parseHrFilters(searchParams);
  if (!allowed.some((c) => c.key === f.report)) f.report = allowed[0].key;

  const supabase = await createClient();
  const [manager, { report, error }, { data: deps }, { data: emps }, { data: projects }] = await Promise.all([
    canManageHr(),
    getHrReport(f),
    supabase.from("departments").select("id, name_ar, parent_id").eq("status", "نشط").order("sort_order"),
    supabase.from("employees").select("id, full_name").order("full_name"),
    supabase.from("projects").select("id, name").order("name"),
  ]);

  const input = "rounded-lg border px-3 py-2 text-sm";
  const exportHref = (format: string) => `/api/hr/reports/export?${filtersQuery(f, { format })}`;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm print:hidden">
        <div className="flex items-center gap-3">
          <Link href={manager ? "/dashboard/hr" : "/dashboard/me"} className="text-sm text-gray-500 hover:text-brand-700">
            ← HR
          </Link>
          <h1 className="text-xl font-bold text-brand-700">تقارير الموارد البشرية</h1>
        </div>
      </header>

      <div className="print:hidden">
        <HrTabs active="admin" manager={manager} />
      </div>

      <section className="space-y-4 p-6">
        {/* المرشّحات — نموذج GET، فالرابط يحمل التقرير كما هو */}
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4 shadow-sm print:hidden">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            التقرير
            <select name="report" defaultValue={f.report} className={input}>
              {allowed.map((c) => (
                <option key={c.key} value={c.key}>{c.title}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            من
            <input type="date" name="from" defaultValue={f.from} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            إلى
            <input type="date" name="to" defaultValue={f.to} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            القسم (وما تحته)
            <select name="department" defaultValue={f.department} className={input}>
              <option value="">الكل</option>
              {((deps ?? []) as { id: string; name_ar: string; parent_id: string | null }[]).map((d) => (
                <option key={d.id} value={d.id}>{d.parent_id ? `— ${d.name_ar}` : d.name_ar}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            الموظف
            <select name="employee" defaultValue={f.employee} className={input}>
              <option value="">الكل</option>
              {((emps ?? []) as { id: string; full_name: string }[]).map((e) => (
                <option key={e.id} value={e.id}>{e.full_name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            المدير المباشر
            <select name="manager" defaultValue={f.manager} className={input}>
              <option value="">الكل</option>
              {((emps ?? []) as { id: string; full_name: string }[]).map((e) => (
                <option key={e.id} value={e.id}>{e.full_name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            المشروع
            <select name="project" defaultValue={f.project} className={input}>
              <option value="">الكل</option>
              {((projects ?? []) as { id: string; name: string }[]).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            الحالة
            <select name="status" defaultValue={f.status} className={input}>
              <option value="all">الكل</option>
              <option value="active">على رأس العمل</option>
              <option value="inactive">غير نشط</option>
            </select>
          </label>
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            عرض
          </button>
        </form>

        {error ? (
          <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : report ? (
          <div className="rounded-2xl border bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div>
                <h2 className="text-lg font-bold text-gray-800">{report.title}</h2>
                <p className="text-xs text-gray-500" dir="ltr">
                  {report.from} → {report.to} · {report.rows.length} صفاً
                </p>
              </div>
              <div className="flex gap-2 print:hidden">
                <a href={exportHref("xlsx")} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">Excel</a>
                <a href={exportHref("csv")} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">CSV</a>
                <PrintButton />
              </div>
            </div>
            {report.rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-500">لا بيانات في هذا المدى والمرشّحات.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      {report.columns.map((c) => (
                        <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right font-semibold">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r, i) => (
                      <tr key={i} className="border-t">
                        {report.columns.map((c) => (
                          <td
                            key={c.key}
                            className="whitespace-nowrap px-3 py-2"
                            dir={c.kind === "text" ? undefined : "ltr"}
                            style={c.kind === "text" ? undefined : { textAlign: "right" }}
                          >
                            {hrCellText(r[c.key], c.kind)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
