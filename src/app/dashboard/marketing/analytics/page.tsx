import Link from "next/link";
import { requireMktMoney } from "@/lib/marketing-guard";
import { baghdadDate } from "@/lib/time";
import { parseMktFilters, withParams } from "@/lib/marketing-filters";
import { buildReport, cellText, REPORTS } from "@/lib/marketing-reports";
import { ATTRIBUTION_MODELS } from "@/lib/marketing-style";
import { Card, MktFilterBar, PageHead, Unavailable } from "@/components/marketing/ui";
import PrintButton from "./print-button";

// ============================================================
// التقارير والإسناد — ستّةٌ وعشرون تقريراً بمُرشِّحاتٍ واحدة وتصديرٍ
// واحد. كلها من دوالّ 125؛ الشاشة تعرض والتصدير يكتب الجدول نفسه.
//
// PDF من المتصفّح («اطبع» ← حفظ PDF) لا من الخادم: مكتبات PDF على Node
// لا تُشكّل العربية (نفس قرار تقارير الـCRM).
// ============================================================
export default async function AnalyticsPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktMoney();
  const f = parseMktFilters(searchParams, baghdadDate());
  const key = REPORTS[searchParams.report ?? ""] ? searchParams.report : searchParams.dim ? dimToReport(searchParams.dim) : "overview";
  const report = await buildReport(key, f);
  const groups = Array.from(new Set(Object.values(REPORTS).map((r) => r.group)));
  const extra = { report: report.key };
  const exportHref = (format: string) => withParams("/api/marketing/export", { ...f.params, report: report.key, format });

  return (
    <>
      <PageHead title="التقارير والإسناد"
        sub={`نموذج الإسناد: ${ATTRIBUTION_MODELS[f.model]}. الإيراد عمولة تلال؛ وقيمة البيع عمودٌ منفصل باسمه. «—» = لا يُحسب (لا كلفة أو لا قاسم) لا صفر.`}
        actions={<div className="flex gap-2 print:hidden">
          <a href={exportHref("xlsx")} className="rounded-lg border px-3 py-2 text-sm">Excel</a>
          <a href={exportHref("csv")} className="rounded-lg border px-3 py-2 text-sm">CSV</a>
          <PrintButton />
        </div>} />

      <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
        <nav className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 text-sm print:hidden">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1 text-xs font-semibold text-gray-400">{g}</p>
              {Object.entries(REPORTS).filter(([, r]) => r.group === g).map(([k, r]) => (
                <Link key={k} href={withParams("/dashboard/marketing/analytics", f.params, { report: k })}
                  className={`block rounded px-2 py-1 ${k === report.key ? "bg-brand-50 font-semibold text-brand-700" : "text-gray-600 hover:bg-gray-50"}`}>{r.title}</Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          <MktFilterBar basePath="/dashboard/marketing/analytics" f={f} showModel extra={extra} />
          <Unavailable error={report.error} />
          <Card title={report.title}>
            {report.note && <p className="mb-3 text-xs text-gray-500">{report.note}</p>}
            {report.rows.length === 0 ? <p className="py-8 text-center text-sm text-gray-400">لا بيانات في المدة.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>{report.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">{c.label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.rows.map((r, i) => (
                      <tr key={i}>
                        {report.columns.map((c, j) => (
                          <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${j > 0 ? "tabular-nums" : ""}`}>
                            {cellText(r[c.key], c.kind, (r.kind as string) ?? undefined)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function dimToReport(dim: string): string {
  return ({ campaign: "campaigns", channel: "channels", project: "projects", content: "content", influencer: "influencers",
    activity: "offline", vendor: "vendors", category: "expenses", employee: "employees", month: "months", landing: "landing" } as Record<string, string>)[dim] ?? "overview";
}
