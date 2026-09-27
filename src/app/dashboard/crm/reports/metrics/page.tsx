import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { getMetricDefs, REPORT_ROLES } from "@/lib/crm-reporting";
import CrmTabs from "../../crm-tabs";

// ============================================================
// تعريفات المقاييس (§51 · §52 · §53).
//
// تُقرأ من crm_metrics — نفس الصفّ الذي يُنفّذه المحرّك. فما يُكتب هنا
// هو ما يُحسب، لا وثيقةٌ بجانب الكود تتقادم عنه.
//
// والتمييز الذي لا يُتنازل عنه (§53): «الآن» و«دخلوا في المدة» و«كانوا
// في نهاية اليوم» ثلاثة أسئلة. الأول والثالث من «الحالة»، والثاني من
// «الأحداث» — والجدول يقول لكل مقياس أيّها هو.
// ============================================================

const CAT: Record<string, string> = { leads: "الليدات", activity: "التواصل", pipeline: "المراحل", outcome: "النتائج", state: "الحالة", followup: "المتابعة" };
const AGG: Record<string, string> = { count: "عدد", clients: "عملاء فريدون", opportunities: "فرص فريدة", ratio: "نسبة" };

export default async function Metrics() {
  const role = await getUserRole();
  if (!REPORT_ROLES.includes(role)) redirect("/dashboard");
  const defs = await getMetricDefs();

  return (
    <div>
      <CrmTabs active="reports" />
      <div className="space-y-4 p-6">
        <Link href="/dashboard/crm/reports" className="text-sm text-brand-700 hover:underline">← التقارير</Link>
        <h1 className="text-xl font-bold text-brand-600">تعريفات المقاييس</h1>
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <Explain title="الآن" body="الحالة من الجداول الحيّة لحظة الفتح. «في مناقشة العرض الآن»." />
          <Explain title="دخلوا في المدة" body="أحداث بتاريخ وقوعها بتوقيت بغداد. «دخلوا مناقشة العرض في سبتمبر» — لا يتغيّر إن تقدّموا بعدها." />
          <Explain title="كانوا في نهاية اليوم" body="اللقطة اليومية. «كانوا في مناقشة العرض مساء ٢٠ سبتمبر» — كما كانت، لا كما هي الآن." />
        </div>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>{["المقياس", "النوع", "التعريف", "الصيغة", "التاريخ المستعمل", "الجداول", "ملاحظة / المقابل القديم", "المسؤول", "حُدّث"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 align-top">
              {defs.map((m) => (
                <tr key={m.code}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-800">{m.name_ar}</p>
                    <p className="font-mono text-[11px] text-gray-400" dir="ltr">{m.code} · {m.name_en}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    <span className={m.source === "events" ? "rounded bg-blue-50 px-1.5 text-blue-800" : "rounded bg-amber-50 px-1.5 text-amber-900"}>
                      {m.source === "events" ? "أحداث في المدة" : "حالة (لقطة/الآن)"}
                    </span>
                    <p className="mt-1 text-gray-500">{CAT[m.category] ?? m.category} · {AGG[m.agg] ?? m.agg}</p>
                  </td>
                  <td className="max-w-sm px-3 py-2 text-xs leading-5 text-gray-700">{m.definition}</td>
                  <td className="max-w-xs px-3 py-2 text-xs text-gray-600">{m.formula}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{m.date_field}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-500" dir="ltr">{m.source_tables}</td>
                  <td className="max-w-xs px-3 py-2 text-xs text-gray-600">
                    {m.notes}
                    {m.legacy_equivalent && <p className="mt-1 font-mono text-[11px] text-gray-400" dir="ltr">≈ {m.legacy_equivalent}</p>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{m.owner}</td>
                  <td className="px-3 py-2 text-xs tabular-nums text-gray-500">{baghdadDate(m.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">التعريف يُغيَّر بهجرة لا من الشاشة — تعريفٌ يتغيّر بنقرة يُفسد مقارنة الأمس باليوم بصمت.</p>
      </div>
    </div>
  );
}

function Explain({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="font-semibold text-gray-800">{title}</p>
      <p className="mt-1 text-xs leading-5 text-gray-600">{body}</p>
    </div>
  );
}
