import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import RejectionReport from "./rejection-report";

// ============================================================
// سجلّ الاستيراد (§48).
//
// الاستيراد يُدخل مئات الصفوف دفعةً. وبعد شهر يُسأل: من رفع هذه
// الدفعة؟ ولماذا رُفض منها أربعون؟ ولا جواب — الملفّ في جهاز من
// رفعه، والمعاينة اختفت بإغلاق التبويب.
//
// هنا يبقى: من، ومتى، وكم أُدخل وكم رُفض وكم كان مكرّراً. وأسباب
// الرفض **صفّاً صفّاً** تُنزَّل ملفّاً يُصحَّح عليه الأصل ويُعاد —
// تقريرٌ يقول «رُفض ٤٠» ولا يقول لماذا يُحبط ولا يُصلِح.
// ============================================================
type ImportRun = {
  id: string;
  file_name: string | null;
  rows_total: number;
  rows_inserted: number;
  rows_rejected: number;
  rows_duplicate: number;
  rejections: { rowNumber: number; errors: string[] }[];
  imported_by_name: string | null;
  created_at: string;
};

export default async function ImportHistoryPage() {
  if (!(await isAdmin())) redirect("/dashboard/clients");

  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_import_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  const runs = (data ?? []) as ImportRun[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/clients/import" className="text-sm text-gray-500 hover:text-brand-700">
          ← الاستيراد
        </Link>
        <h1 className="text-xl font-bold text-brand-700">سجلّ الاستيراد</h1>
      </header>

      <section className="p-6">
        <p className="mb-4 text-sm text-gray-500">
          آخر ٥٠ عملية. أسباب الرفض تُنزَّل ملفّاً تُصحَّح عليه الصفوف ويُعاد رفعها — لا يُعاد الملفّ كلّه.
        </p>

        {runs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا عمليات استيراد مسجَّلة بعد.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[820px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">التاريخ</th>
                  <th className="px-4 py-3 font-medium">الملفّ</th>
                  <th className="px-4 py-3 font-medium">من</th>
                  <th className="px-4 py-3 font-medium">الصفوف</th>
                  <th className="px-4 py-3 font-medium">أُدخل</th>
                  <th className="px-4 py-3 font-medium">رُفض</th>
                  <th className="px-4 py-3 font-medium">مكرّر</th>
                  <th className="px-4 py-3 font-medium">تقرير الأخطاء</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-4 py-3 text-xs text-gray-500" dir="ltr">
                      {r.created_at.slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800">{r.file_name ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{r.imported_by_name ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{r.rows_total}</td>
                    <td className="px-4 py-3 font-semibold text-brand-700">{r.rows_inserted}</td>
                    <td className={`px-4 py-3 ${r.rows_rejected > 0 ? "font-semibold text-red-700" : "text-gray-400"}`}>
                      {r.rows_rejected || "—"}
                    </td>
                    <td className={`px-4 py-3 ${r.rows_duplicate > 0 ? "text-amber-700" : "text-gray-400"}`}>
                      {r.rows_duplicate || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {r.rows_rejected > 0 ? (
                        <RejectionReport
                          fileName={r.file_name}
                          createdAt={r.created_at}
                          rejections={r.rejections ?? []}
                        />
                      ) : (
                        <span className="text-xs text-gray-400">لا أخطاء</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
