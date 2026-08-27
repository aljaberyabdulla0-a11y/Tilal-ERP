import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeBrokers, isAdmin } from "@/lib/auth";
import {
  commissionStatusOf,
  getBrokerCommissions,
  getBrokerPayments,
  paidByCommission,
} from "@/lib/brokers";
import {
  COMMISSION_STATUS_COLORS,
  formatPrice,
} from "@/lib/types";
import BrokersTabs from "../brokers-tabs";
import AddPayment from "./add-payment";

// ============================================================
// عمولات الشركات الوسيطة وصرفها.
//
// كل صفّ يجيب: كم استحقّت الشركة، وكم قبضت، وكم بقي لها. والحالة
// محسوبة من المدفوعات لا مخزَّنة — فلا يوجد صفّ يقول «مدفوعة» ولا
// دفعة تسنده.
// ============================================================
export default async function BrokerCommissionsPage() {
  if (!(await canSeeBrokers())) redirect("/dashboard");

  const [commissions, payments, admin] = await Promise.all([
    getBrokerCommissions(),
    getBrokerPayments(),
    isAdmin(),
  ]);

  const paid = paidByCommission(payments);

  const totals = commissions.reduce(
    (acc, c) => {
      const p = paid.get(c.id) ?? 0;
      acc.earned += Number(c.amount);
      acc.paid += p;
      acc.remaining += Math.max(0, Number(c.amount) - p);
      return acc;
    },
    { earned: 0, paid: 0, remaining: 0 }
  );

  const kpi = "glass-card border-s-4 p-5";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">عمولات الوساطة</h1>
      </header>

      <BrokersTabs active="commissions" />

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className={kpi + " border-s-brand-500"}>
            <span className="text-sm text-gray-500">إجمالي المستحق</span>
            <p className="mt-1 text-2xl font-bold text-gray-800" dir="ltr">
              {formatPrice(totals.earned)}
            </p>
          </div>
          <div className={kpi + " border-s-emerald-500"}>
            <span className="text-sm text-gray-500">المصروف فعلاً</span>
            <p className="mt-1 text-2xl font-bold text-emerald-700" dir="ltr">
              {formatPrice(totals.paid)}
            </p>
          </div>
          <div className={kpi + (totals.remaining ? " border-s-amber-500" : " border-s-emerald-500")}>
            <span className="text-sm text-gray-500">الباقي في ذمّتنا</span>
            <p
              className={`mt-1 text-2xl font-bold ${
                totals.remaining ? "text-amber-700" : "text-emerald-700"
              }`}
              dir="ltr"
            >
              {formatPrice(totals.remaining)}
            </p>
          </div>
        </div>

        {commissions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا عمولات بعد. تُسجَّل تلقائياً حين يُحوَّل حجز ليد شركةٍ إلى
            «بيع مكتمل».
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full min-w-[1000px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">التاريخ</th>
                  <th className="px-4 py-3 text-start font-medium">الشركة</th>
                  <th className="px-4 py-3 text-start font-medium">العميل</th>
                  <th className="px-4 py-3 text-start font-medium">الوحدة</th>
                  <th className="px-4 py-3 text-start font-medium">قيمة الصفقة</th>
                  <th className="px-4 py-3 text-start font-medium">النسبة</th>
                  <th className="px-4 py-3 text-start font-medium">العمولة</th>
                  <th className="px-4 py-3 text-start font-medium">المدفوع</th>
                  <th className="px-4 py-3 text-start font-medium">الباقي</th>
                  <th className="px-4 py-3 text-start font-medium">الحالة</th>
                  {admin && <th className="px-4 py-3 text-start font-medium">صرف</th>}
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => {
                  const p = paid.get(c.id) ?? 0;
                  const remaining = Math.max(0, Number(c.amount) - p);
                  const status = commissionStatusOf(c, paid);
                  return (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600" dir="ltr">
                        {c.earned_at}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/brokers/${c.company_id}`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          {c.broker_companies?.name ?? "—"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {c.clients?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {c.units
                          ? `${c.units.project ?? ""} ${c.units.unit_code ?? ""}`.trim() || "—"
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600" dir="ltr">
                        {formatPrice(Number(c.deal_amount))}
                      </td>
                      <td className="px-4 py-3 text-gray-600" dir="ltr">
                        {c.rate}%
                      </td>
                      <td className="px-4 py-3 font-bold text-gray-800" dir="ltr">
                        {formatPrice(Number(c.amount))}
                      </td>
                      <td className="px-4 py-3 text-emerald-700" dir="ltr">
                        {formatPrice(p)}
                      </td>
                      <td className="px-4 py-3 font-semibold" dir="ltr">
                        <span className={remaining ? "text-amber-700" : "text-emerald-700"}>
                          {formatPrice(remaining)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${COMMISSION_STATUS_COLORS[status]}`}
                        >
                          {status}
                        </span>
                      </td>
                      {admin && (
                        <td className="px-4 py-3">
                          {remaining > 0 ? (
                            <AddPayment commissionId={c.id} remaining={remaining} />
                          ) : (
                            <span className="text-xs text-gray-400">مسدَّدة</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
