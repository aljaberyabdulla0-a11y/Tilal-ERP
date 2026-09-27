import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import { baghdadDate, baghdadTime } from "@/lib/time";
import { getReportRuns, REPORT_ROLES } from "@/lib/crm-reporting";
import { fmtNum } from "@/lib/report-engine";
import CrmTabs from "../../crm-tabs";

// سجلّ تشغيل التقارير (§40) — من ولّد ماذا ومتى، بأيّ مدى ومُرشِّحات،
// وكم صفّاً وكم استغرق، وآخر لقطة كانت متاحة يومها. كلٌّ يرى تشغيله
// وما وصله مجدولاً؛ المدير يرى الكل (099).
const TRIGGER: Record<string, string> = { manual: "توليد", schedule: "مجدول", export: "تصدير" };
const FORMAT: Record<string, string> = { view: "عرض", xlsx: "Excel", csv: "CSV", pdf: "PDF" };

export default async function History() {
  const role = await getUserRole();
  if (!REPORT_ROLES.includes(role)) redirect("/dashboard");
  const runs = await getReportRuns(200);

  return (
    <div>
      <CrmTabs active="reports" />
      <div className="space-y-4 p-6">
        <Link href="/dashboard/crm/reports" className="text-sm text-brand-700 hover:underline">← التقارير</Link>
        <h1 className="text-xl font-bold text-brand-600">سجلّ تشغيل التقارير</h1>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>{["الوقت", "التقرير", "بطلب", "النوع", "المدى", "صفوف", "المدة", "آخر لقطة", "الحالة", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-gray-600">{baghdadDate(r.started_at)} {baghdadTime(r.started_at)}</td>
                  <td className="px-3 py-2 font-medium text-gray-800">{r.report_name}{r.template_version ? <span className="ms-1 text-[11px] text-gray-400">v{r.template_version}</span> : null}</td>
                  <td className="px-3 py-2 text-xs">{r.requested_by_name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{TRIGGER[r.trigger_kind] ?? r.trigger_kind} · {FORMAT[r.format] ?? r.format}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{r.date_from} ← {r.date_to}</td>
                  <td className="px-3 py-2 tabular-nums">{fmtNum(r.rows_returned)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{r.duration_ms !== null ? `${fmtNum(r.duration_ms)}ms` : "—"}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{r.snapshot_date ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.status === "failed" ? <span className="text-red-700" title={r.error ?? ""}>فشل</span> : r.status === "delivered" ? "أُرسل" : "اكتمل"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.template_id && <Link href={`/dashboard/crm/reports/view?run=${r.id}`} className="text-brand-700 hover:underline">افتح</Link>}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">لا تشغيل بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
