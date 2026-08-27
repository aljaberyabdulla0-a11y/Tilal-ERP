import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeBrokers, isAdmin } from "@/lib/auth";
import {
  bucketLeads,
  getBrokerCompanies,
  getBrokerLeads,
  getReturnedLeads,
} from "@/lib/brokers";
import {
  Client,
  PIPELINE_STAGE_COLORS,
  leadDaysLeft,
  leadDeadlineColor,
  leadDeadlineLabel,
} from "@/lib/types";
import BrokersTabs from "../brokers-tabs";
import LeadActions from "./lead-actions";
import RunScan from "./run-scan";

// ============================================================
// ليدات الوساطة ومهلها.
//
// ترتيب الأقسام هو ترتيب ما يحتاج قراراً:
//   1) عادت إلى تلال وتنتظر التوزيع  ← قرار الآن
//   2) انتهت مهلتها ولم يمرّ الفحص بعد
//   3) باقٍ لها ٣ أيام أو أقل
//   4) بقية الليدات
// ============================================================
export default async function BrokerLeadsPage() {
  if (!(await canSeeBrokers())) redirect("/dashboard");

  const [leads, returned, companies, admin] = await Promise.all([
    getBrokerLeads(),
    getReturnedLeads(),
    getBrokerCompanies(),
    isAdmin(),
  ]);

  const buckets = bucketLeads(leads);

  const kpi = "glass-card border-s-4 p-5";

  // جدول ليدات موحّد — يُعاد استعماله في كل قسم بعنوان مختلف
  function LeadTable({
    rows,
    emptyText,
    showActions,
  }: {
    rows: Client[];
    emptyText: string;
    showActions?: boolean;
  }) {
    if (rows.length === 0) {
      return <p className="p-8 text-center text-sm text-gray-500">{emptyText}</p>;
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-start text-sm">
          <thead className="border-b bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-3 text-start font-medium">العميل</th>
              <th className="px-4 py-3 text-start font-medium">الهاتف</th>
              <th className="px-4 py-3 text-start font-medium">الشركة</th>
              <th className="px-4 py-3 text-start font-medium">المشروع</th>
              <th className="px-4 py-3 text-start font-medium">المرحلة</th>
              <th className="px-4 py-3 text-start font-medium">المهلة</th>
              {showActions && admin && (
                <th className="px-4 py-3 text-start font-medium">إجراء</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const days = leadDaysLeft(l.broker_deadline);
              return (
                <tr key={l.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/clients/${l.id}`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      {l.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600" dir="ltr">
                    {l.phone ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {l.broker_companies?.name ?? (
                      <span className="text-amber-700">عاد لتلال</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {l.projects?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        PIPELINE_STAGE_COLORS[l.stage ?? "ليد"] ??
                        "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {l.stage ?? "ليد"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {l.broker_company_id ? (
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${leadDeadlineColor(days)}`}
                      >
                        {leadDeadlineLabel(days)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">
                        {l.returned_at
                          ? `عاد ${new Date(l.returned_at).toLocaleDateString("ar")}`
                          : "—"}
                      </span>
                    )}
                  </td>
                  {showActions && admin && (
                    <td className="px-4 py-3">
                      <LeadActions
                        clientId={l.id}
                        companies={companies}
                        currentCompanyId={l.broker_company_id}
                        canExtend
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">ليدات الوساطة</h1>
        </div>
        {admin && <RunScan />}
      </header>

      <BrokersTabs active="leads" />

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className={kpi + (returned.length ? " border-s-amber-500" : " border-s-gray-300")}>
            <span className="text-sm text-gray-500">تنتظر التوزيع</span>
            <p className={`mt-1 text-2xl font-bold ${returned.length ? "text-amber-700" : "text-gray-500"}`}>
              {returned.length}
            </p>
          </div>
          <div className={kpi + " border-s-red-500"}>
            <span className="text-sm text-gray-500">مهل حرجة</span>
            <p className="mt-1 text-2xl font-bold text-red-700">
              {buckets.urgent.length + buckets.expired.length}
            </p>
          </div>
          <div className={kpi + " border-s-blue-500"}>
            <span className="text-sm text-gray-500">ضمن المهلة</span>
            <p className="mt-1 text-2xl font-bold text-blue-700">{buckets.active.length}</p>
          </div>
          <div className={kpi + " border-s-emerald-500"}>
            <span className="text-sm text-gray-500">أُغلقت بيعاً</span>
            <p className="mt-1 text-2xl font-bold text-emerald-700">{buckets.closed.length}</p>
          </div>
        </div>

        {/* عادت لتلال */}
        <div className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-4">
            <h2 className="text-lg font-bold text-amber-800">
              عادت إلى تلال وتنتظر التوزيع ({returned.length})
            </h2>
            <p className="text-sm text-amber-700">
              انتهت مهلتها عند شركتها. وزّعها على شركة أخرى، أو اتركها لموظفي
              تلال بإسناد «موظف المبيعات» من صفحة العميل.
            </p>
          </div>
          <LeadTable
            rows={returned}
            emptyText="لا شيء ينتظر التوزيع — كل الليدات عند أصحابها."
            showActions
          />
        </div>

        {/* مهل حرجة */}
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-6 py-4">
            <h2 className="text-lg font-bold text-gray-800">
              مهل حرجة ({buckets.expired.length + buckets.urgent.length})
            </h2>
            <p className="text-sm text-gray-500">
              انتهت أو باقٍ لها ثلاثة أيام أو أقل.
            </p>
          </div>
          <LeadTable
            rows={[...buckets.expired, ...buckets.urgent]}
            emptyText="لا مهل حرجة اليوم."
            showActions
          />
        </div>

        {/* البقية */}
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-6 py-4">
            <h2 className="text-lg font-bold text-gray-800">
              ضمن المهلة ({buckets.active.length})
            </h2>
          </div>
          <LeadTable rows={buckets.active} emptyText="لا ليدات." showActions />
        </div>

        {/* المغلقة بيعاً */}
        {buckets.closed.length > 0 && (
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-bold text-gray-800">
                أُغلقت بيعاً ({buckets.closed.length})
              </h2>
              <p className="text-sm text-gray-500">
                لا مهلة عليها — أنجزت الشركة عملها واستحقّت عمولتها.
              </p>
            </div>
            <LeadTable rows={buckets.closed} emptyText="—" />
          </div>
        )}
      </section>
    </main>
  );
}
