import Link from "next/link";
import { redirect } from "next/navigation";
import { isBroker } from "@/lib/auth";
import {
  commissionStatusOf,
  companyMoney,
  getBrokerCommissions,
  getBrokerPayments,
  getBrokerProjects,
  getCommissionAdjustments,
  getCommissionPlans,
  getMyBrokerCompany,
  paidByCommission,
  planMeasure,
} from "@/lib/brokers";
import {
  BrokerPayment,
  COMMISSION_STATUS_COLORS,
  effectivePlan,
  formatPrice,
  nextPlanTier,
  planRate,
  planTiersLabel,
} from "@/lib/types";

// ============================================================
// «استحقاقاتنا» — شاشة الشركة الوسيطة المالية.
//
// ثلاثة أرقام تُجيب عن كل سؤال مالي: كم استحققنا، وكم قبضنا، وكم بقي
// لنا. ثم تفصيل كل عمولة ودفعاتها — فلا يحتاج أحد أن يسأل تلال.
//
// والشرائح (sql/117): لكل مشروع شرائح تصاعدية بعدد وحداتكم في الشهر،
// وبلوغ شريحة يرفع كل صفقات الشهر — فنعرض أين أنتم من الشريحة التالية،
// وتحت كل صفقة رُفعت نسبتها ما الذي تغيّر ولماذا.
// ============================================================
export default async function BrokerCommissionsPage() {
  if (!(await isBroker())) redirect("/dashboard");

  const [company, commissions, payments, links, plans, adjustments] = await Promise.all([
    getMyBrokerCompany(),
    getBrokerCommissions(),
    getBrokerPayments(),
    getBrokerProjects(),
    getCommissionPlans(),
    getCommissionAdjustments(),
  ]);

  const paid = paidByCommission(payments);
  const money = companyMoney(commissions, paid);

  // المستحق ينقسم: قابلٌ للصرف الآن، وما ينتظر قاعدة الخطة (sql/129)
  const payableNow = commissions
    .filter((c) => !c.reversed_at && c.payable_at)
    .reduce((s, c) => s + Math.max(0, Number(c.amount) - (paid.get(c.id) ?? 0)), 0);
  const waiting = commissions
    .filter((c) => !c.reversed_at && !c.payable_at)
    .reduce((s, c) => s + Math.max(0, Number(c.amount) - (paid.get(c.id) ?? 0)), 0);

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
            {company ? `${company.name} — عمولة بشرائح تصاعدية لكل مشروع` : ""}
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
            {money.remaining > 0 && (
              <p className="mt-1 text-[11px] text-gray-500">
                قابل للصرف الآن <span dir="ltr">{formatPrice(payableNow)}</span> · ينتظر{" "}
                <span dir="ltr">{formatPrice(waiting)}</span>
              </p>
            )}
          </div>
          <div className={kpi + " border-s-blue-500"}>
            <span className="text-sm text-gray-500">صفقات مغلقة</span>
            <p className="mt-1 text-2xl font-bold text-blue-700">{money.deals}</p>
          </div>
        </div>

        {/* الشرائح — أين نحن هذا الشهر */}
        {company && links.length > 0 && (
          <div className="glass-card p-5">
            <h2 className="mb-3 text-lg font-bold text-gray-800">شرائحنا في الفترة الجارية</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {links.map((l) => {
                const plan = effectivePlan(plans, l.project_id, "وسيط", { companyId: company.id });
                const tiers = plan?.commission_plan_tiers ?? [];
                const value = plan?.basis === "قيمة المبيعات";
                const n = plan ? planMeasure(commissions, plan, company.id) : 0;
                const next = plan ? nextPlanTier(plan, tiers, n) : null;
                const top = Math.max(1, ...tiers.map((t) => Number(value ? t.min_value ?? 0 : t.min_units ?? 1)));
                const show = (x: number) => (value ? formatPrice(x) : `${x} وحدة`);
                return (
                  <div key={l.project_id} className="rounded-xl bg-gray-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <b className="text-gray-800">{l.projects?.name ?? "مشروع"}</b>
                      <span className="text-sm text-gray-600">
                        <span dir="ltr">{show(n)}</span> ←{" "}
                        <b className="text-brand-800">{plan ? planRate(plan, tiers, n).rate : 0}٪</b>
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-brand-600"
                        style={{ width: `${Math.min(100, (n / top) * 100)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      {!plan
                        ? "لم تُعرَّف خطة عمولة لهذا المشروع بعد"
                        : next
                        ? plan.formula === "شرائح رجعية"
                          ? `باقٍ ${show(next.remaining)} لتصير كل صفقات الفترة ${next.rate}٪`
                          : `باقٍ ${show(next.remaining)} لتصير صفقاتكم التالية ${next.rate}٪`
                        : "بلغتم أعلى شريحة في هذه الفترة 🎯"}
                    </p>
                    {plan && (
                      <p className="mt-1 text-[11px] text-gray-400">
                        {plan.formula} · {plan.period} · {planTiersLabel(plan, tiers)} · تُصرف {plan.payable_rule}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
              const changes = adjustments.filter((a) => a.commission_id === c.id);

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
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${COMMISSION_STATUS_COLORS[status]}`}
                      >
                        {status}
                      </span>
                      {!c.reversed_at && remaining > 0 && (
                        <span className="text-[11px] text-gray-500">
                          {c.payable_at ? (
                            <>قابلة للصرف منذ <span dir="ltr">{c.payable_at}</span></>
                          ) : (
                            `تُصرف ${c.payable_rule ?? "بعد تحصيل عمولة تلال"}`
                          )}
                        </span>
                      )}
                    </div>
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

                  {c.reversed_at && (
                    <p className="mt-3 rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600">
                      فُسخت الصفقة{c.reversal_reason ? ` — ${c.reversal_reason}` : ""}، فخرجت من
                      المستحق ومن عدّ الشهر.
                    </p>
                  )}

                  {changes.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {changes.map((a) => (
                        <p key={a.id} className="rounded-lg bg-brand-50 px-3 py-1.5 text-xs text-brand-900">
                          <span dir="ltr">{a.created_at.slice(0, 10)}</span> · {a.reason ?? "تعديل"}:{" "}
                          {Number(a.old_rate)}٪ ← {Number(a.new_rate)}٪ (
                          <span dir="ltr">
                            {formatPrice(Number(a.old_amount))} → {formatPrice(Number(a.new_amount))}
                          </span>
                          )
                        </p>
                      ))}
                    </div>
                  )}

                  {list.length > 0 && (
                    <div className="mt-4">
                      <h4 className="mb-2 text-xs font-bold uppercase text-gray-400">
                        الدفعات المستلمة
                      </h4>
                      <div className="space-y-1">
                        {list.map((pay) => (
                          <div
                            key={pay.id}
                            className={`flex flex-wrap justify-between gap-2 rounded-lg px-3 py-2 text-xs ${
                              pay.kind === "استرداد" ? "bg-red-50" : "bg-emerald-50"
                            }`}
                          >
                            <span
                              className={`font-semibold ${pay.kind === "استرداد" ? "text-red-700" : "text-emerald-800"}`}
                              dir="ltr"
                            >
                              {pay.kind === "استرداد" ? "−" : ""}
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
