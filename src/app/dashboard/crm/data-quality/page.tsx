import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import { getDataQuality, getDuplicates, SEVERITY_STYLE, fmt } from "@/lib/crm";
import CrmTabs from "../crm-tabs";
import DuplicatesPanel from "./duplicates-panel";
import QualityActions from "./quality-actions";

// ============================================================
// «الجودة» — الخلل يُعرَض ولا يُصلَح تلقائياً (sql/077).
//
// كل رقم هنا يُفسد رقماً في لوحة الإدارة: عميل بلا هاتف لا يُتّصل
// به فيُحسب مهملاً؛ ليد بلا مالك لا يظهر في أداء أحد؛ تكرارٌ يضاعف
// الليدات ويقسم التواصل على نسختين. لذلك كل صفّ يحمل **مسار
// المعالجة** — تقريرٌ يقول «٦٢ خطأ» ولا يقول أين يُصلَح يُحبط ولا
// يُصلِح.
//
// الإصلاح الآلي الوحيد: المسافات الزائدة، لأن لا رأي فيها. وكل ما
// عداه — دمج، حذف، تصحيح رقم — قرارُ بشر يُوقّع عليه.
// ============================================================
export default async function DataQualityPage() {
  const role = await getUserRole();
  if (role !== "admin" && role !== "followup_manager") {
    redirect("/dashboard/crm/today");
  }
  const admin = role === "admin";

  const [issues, duplicates] = await Promise.all([getDataQuality(), getDuplicates()]);

  const confirmed = duplicates.filter((d) => d.match_type === "مؤكّد");
  const others = duplicates.filter((d) => d.match_type !== "مؤكّد");
  const whitespace = issues.find((i) => i.code === "whitespace");

  return (
    <div>
      <CrmTabs active="data-quality" />

      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-600">جودة البيانات</h1>
            <p className="mt-1 text-sm text-gray-500">
              كل ملاحظة هنا تُفسد رقماً في «نظرة». الخلل يُعرَض ويُشار إلى مكان إصلاحه — ولا يُصلَح خلف ظهرك.
            </p>
          </div>
          {admin && <QualityActions whitespaceCount={whitespace ? Number(whitespace.affected) : 0} />}
        </header>

        {/* ===== الفحوص ===== */}
        <section>
          {issues.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-400">
              لا ملاحظات — أو الهجرة ٠٧٧ لم تُشغَّل بعد. الفرق يظهر في سجلّ الخادم.
            </p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {issues.map((i) => {
                const internal = i.fix_path.startsWith("/");
                return (
                  <li
                    key={i.code}
                    className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-sm ${SEVERITY_STYLE[i.severity]}`}
                  >
                    <div>
                      <p className="font-semibold">{i.title}</p>
                      <p className="text-xs opacity-70">{i.severity}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-bold">{fmt(i.affected)}</span>
                      {internal ? (
                        <Link href={i.fix_path} className="rounded border border-current px-2 py-1 text-xs hover:opacity-80">
                          أصلح
                        </Link>
                      ) : (
                        <span className="text-xs opacity-60">{i.fix_path}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ===== التكرار ===== */}
        <section id="duplicates" className="space-y-4">
          <div>
            <h2 className="font-bold text-gray-800">التكرار</h2>
            <p className="text-sm text-gray-500">
              «مؤكّد» = الرقم نفسه. «محتمل» = رقم أحدهما هو الرقم البديل للآخر. «مرشّح» = تشابه اسم فقط، للعين البشرية.
              الدمج ينقل كل شيء — الأنشطة والفرص والحجوزات والمهامّ — إلى المحفوظ ولا يمحو شيئاً.
            </p>
          </div>
          <DuplicatesPanel title="مؤكّد" pairs={confirmed} canMerge={admin} />
          <DuplicatesPanel title="محتمل ومرشّح" pairs={others} canMerge={admin} />
        </section>
      </div>
    </div>
  );
}
