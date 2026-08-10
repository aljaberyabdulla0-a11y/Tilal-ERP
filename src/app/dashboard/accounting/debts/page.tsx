import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getDebtsState } from "@/lib/money";
import { formatPrice } from "@/lib/types";
import AccTabs from "../acc-tabs";
import AddDebt from "./add-debt";
import DebtActions from "./debt-actions";

// ============================================================
// الديون الخارجية — فلوس نعطيها لناس نشتغل وياهم ونستحصلها لاحقاً.
// خانة منعزلة تماماً عن المصاريف: حسابها 1350 (أصول)، فلا تنقص
// أرباح الشركة ولا تظهر في «وين تروح فلوسنا».
// ============================================================
export default async function DebtsPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const s = await getDebtsState();

  const kpis = [
    {
      label: "ما زال بذمّة الناس",
      value: s.outstanding,
      icon: "pending_actions",
      color: s.outstanding > 0 ? "text-amber-700" : "text-gray-500",
      border: "border-r-amber-500",
    },
    {
      label: "إجمالي ما أعطيناه",
      value: s.given,
      icon: "call_made",
      color: "text-gray-800",
      border: "border-r-brand-500",
    },
    {
      label: "استحصلناه",
      value: s.collected,
      icon: "call_received",
      color: "text-green-700",
      border: "border-r-green-500",
    },
    {
      label: `متأخر عن موعده (${s.overdueCount})`,
      value: s.overdueAmount,
      icon: "running_with_errors",
      color: s.overdueCount > 0 ? "text-red-700" : "text-gray-500",
      border: s.overdueCount > 0 ? "border-r-red-500" : "border-r-gray-300",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-brand-700">الديون الخارجية</h1>
          <p className="text-sm text-gray-500">
            فلوس أعطيناها لناس نشتغل وياهم — ونستحصلها لاحقاً.
          </p>
        </div>
        <AddDebt />
      </header>

      <AccTabs active="debts" />

      <section className="space-y-6 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className={`glass-card border-r-4 p-5 ${k.border}`}>
              <div className="flex items-start justify-between">
                <span className="text-sm text-gray-500">{k.label}</span>
                <span className="material-symbols-outlined text-gray-300">{k.icon}</span>
              </div>
              <p className={`mt-2 text-2xl font-bold ${k.color}`} dir="ltr">
                {formatPrice(k.value)}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-gray-700">
          <b className="text-blue-800">هذه ليست مصاريف.</b> المبلغ لا يُحسب خسارة على
          الشركة — هو ينتقل من الصندوق إلى ذمّة الشخص، ويرجع للصندوق عند الاستحصال.
          لذلك لا تظهر هذه المبالغ في «وين تروح فلوسنا» ولا تنقص صافي الربح.
        </div>

        {s.rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا توجد ديون خارجية مسجّلة. اضغط «سجّل دَين جديد» في الأعلى.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full min-w-[1000px] text-right text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الشخص / الجهة</th>
                  <th className="px-4 py-3 font-medium">على شنو</th>
                  <th className="px-4 py-3 font-medium">المبلغ</th>
                  <th className="px-4 py-3 font-medium">استُحصل</th>
                  <th className="px-4 py-3 font-medium">المتبقّي</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">التواريخ</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((d) => (
                  <tr key={d.id} className="border-b last:border-0 align-top hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-800">{d.person_name}</span>
                      <span className="block text-xs text-gray-400">
                        {d.person_kind}
                        {d.person_phone && (
                          <>
                            {" · "}
                            <a
                              href={`tel:${d.person_phone}`}
                              dir="ltr"
                              className="text-brand-700 hover:underline"
                            >
                              {d.person_phone}
                            </a>
                          </>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {d.reason || <span className="text-gray-300">—</span>}
                      <span className="block text-xs text-gray-400">
                        من {d.method === "بنك" ? "البنك" : "الصندوق"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-800" dir="ltr">
                      {formatPrice(d.amount)}
                    </td>
                    <td className="px-4 py-3 text-green-700" dir="ltr">
                      {d.collected > 0 ? (
                        <>
                          {formatPrice(d.collected)}
                          <span
                            dir="rtl"
                            className="block text-xs text-gray-400"
                          >
                            {d.repayments.length} دفعة
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 font-bold ${
                        d.remaining > 0.009 ? "text-amber-700" : "text-gray-300"
                      }`}
                      dir="ltr"
                    >
                      {d.remaining > 0.009 ? formatPrice(d.remaining) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${d.status.color}`}
                      >
                        {d.status.label}
                      </span>
                      {d.overdue && (
                        <span className="mt-1 block whitespace-nowrap text-xs font-medium text-red-600">
                          ⚠ فات موعده
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      <span dir="ltr" className="block">
                        انعطى: {d.debt_date}
                      </span>
                      <span
                        dir="ltr"
                        className={`block ${d.overdue ? "font-semibold text-red-600" : ""}`}
                      >
                        {d.due_date ? `موعده: ${d.due_date}` : "بلا موعد"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-left">
                      <DebtActions
                        debtId={d.id}
                        personName={d.person_name}
                        remaining={d.remaining}
                      />
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
