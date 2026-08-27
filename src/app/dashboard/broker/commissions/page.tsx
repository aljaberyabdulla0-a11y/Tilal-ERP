import Link from "next/link";
import { redirect } from "next/navigation";
import { isBroker } from "@/lib/auth";
import {
  commissionStatusOf,
  companyMoney,
  getBrokerCommissions,
  getBrokerPayments,
  getMyBrokerCompany,
  paidByCommission,
} from "@/lib/brokers";
import {
  BrokerPayment,
  COMMISSION_STATUS_COLORS,
  formatPrice,
} from "@/lib/types";

// ============================================================
// «استحقاقاتنا» — شاشة الشركة الوسيطة المالية.
//
// ثلاثة أرقام تُجيب عن كل سؤال مالي: كم استحققنا، وكم قبضنا، وكم بقي
// لنا. ثم تفصيل كل عمولة ودفعاتها — فلا يحتاج أحد أن يسأل تلال.
// ============================================================
export default async function BrokerCommissionsPage() {
  if (!(await isBroker())) redirect("/dashboard");

  const [company, commissions, payments] = await Promise.all([
    getMyBrokerCompany(),
    getBrokerCommissions(),
    getBrokerPayments(),
  ]);

  const paid = paidByCommission(payments);
  const money = companyMoney(commissions, paid);

  // دفعات كل عمولة مرتبة للعرض تحتها
  const paymentsOf = (commissionId: string): BrokerPayment[] =>
    payments.filter((p) => p.commission_id === commissionId);

  const kpi = "glass-card border-s-4 p-5";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحتنا
        </Link>
        <div>
          <h1 className="text-xl font-bold text-brand-700">استحقاقاتنا</h1>
          <p className="text-sm text-gray-500">
            {company ? `${company.name} — نسبة ${company.commission_rate}٪ من كل بيع` : ""}
          </p>
        </div>
      </header>

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className={kpi + " border-s-brand-500"}>
            <span className="text-sm text-gray-500">إجمالي المستحق</span>
            <p className="mt-1 text-2xl font-bold text-gray-800" dir="ltr">
              {formatPrice(money.earned)}
            </p>
          </div>
          <div className={kpi + " border-s-emerald-500"}>
            <span className="text-sm text-gray-500">المقبوض</span>
            <p className="mt-1 text-2xl font-bold text-emerald-700" dir="ltr">
              {formatPrice(money.paid)}
            </p>
          </div>
          <div className={kpi + (money.remaining ? " border-s-amber-500" : " border-s-emerald-500")}>
            <span className="text-sm text-gray-500">الباقي لنا</span>
            <p
              className={`mt-1 text-2xl font-bold ${
                money.remaining ? "text-amber-700" : "text-emerald-700"
              }`}
              dir="ltr"
            >
              {formatPrice(money.remaining)}
            </p>
          </div>
          <div className={kpi + " border-s-blue-500"}>
            <span className="text-sm text-gray-500">صفقات مغلقة</span>
            <p className="mt-1 text-2xl font-bold text-blue-700">{money.deals}</p>
          </div>
        </div>

        {commissions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا عمولات بعد. تُسجَّل تلقائياً حال إتمام بيع لأحد ليداتكم، ويصلكم
            إشعار بها.
          </div>
        ) : (
          <div className="space-y-3">
            {commissions.map((c) => {
              const p = paid.get(c.id) ?? 0;
              const remaining = Math.max(0, Number(c.amount) - p);
              const status = commissionStatusOf(c, paid);
              const list = paymentsOf(c.id);

              return (
                <div key={c.id} className="glass-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-gray-800">
                        {c.clients?.name ?? "عميل"}
                      </h3>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {c.projects?.name ?? c.units?.project ?? ""}
                        {c.units?.unit_code ? ` · وحدة ${c.units.unit_code}` : ""}
                        {" · "}
                        <span dir="ltr">{c.earned_at}</span>
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${COMMISSION_STATUS_COLORS[status]}`}
                    >
                      {status}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: "قيمة الصفقة", value: formatPrice(Number(c.deal_amount)), color: "text-gray-700" },
                      { label: `العمولة (${c.rate}٪)`, value: formatPrice(Number(c.amount)), color: "text-gray-900 font-bold" },
                      { label: "المقبوض", value: formatPrice(p), color: "text-emerald-700" },
                      { label: "الباقي", value: formatPrice(remaining), color: remaining ? "text-amber-700" : "text-emerald-700" },
                    ].map((f) => (
                      <div key={f.label} className="rounded-xl bg-gray-50 p-3">
                        <span className="block text-[11px] font-bold uppercase text-gray-400">
                          {f.label}
                        </span>
                        <span className={`mt-1 block ${f.color}`} dir="ltr">
                          {f.value}
                        </span>
                      </div>
                    ))}
                  </div>

                  {list.length > 0 && (
                    <div className="mt-4">
                      <h4 className="mb-2 text-xs font-bold uppercase text-gray-400">
                        الدفعات المستلمة
                      </h4>
                      <div className="space-y-1">
                        {list.map((pay) => (
                          <div
                            key={pay.id}
                            className="flex flex-wrap justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs"
                          >
                            <span className="font-semibold text-emerald-800" dir="ltr">
                              {formatPrice(Number(pay.amount))}
                            </span>
                            <span className="text-gray-600">
                              <span dir="ltr">{pay.payment_date}</span>
                              {pay.method ? ` · ${pay.method}` : ""}
                              {pay.notes ? ` · ${pay.notes}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
