import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getMoneyOverview, getPartnersState } from "@/lib/money";
import { ARM_COLORS, formatPrice } from "@/lib/types";
import AccTabs from "./acc-tabs";

// ============================================================
// الملخص المالي — الصفحة الأولى للمحاسبة، بلغة بسيطة بلا مصطلحات.
// كل الأرقام تُحسب من دفتر القيود، فتشمل الحركات اليدوية ورواتب HR
// وعمولات الموظفين ودفعات الفواتير معاً.
// ============================================================
export default async function AccountingHome() {
  if (!(await isAdmin())) redirect("/dashboard");

  const [o, partners] = await Promise.all([getMoneyOverview(), getPartnersState()]);

  const topCategories = o.byCategory.slice(0, 8);
  const maxCat = Math.max(...topCategories.map((c) => c.amount), 1);
  const maxArm = Math.max(...o.byArm.map((a) => a.amount), 1);
  const maxMonth = Math.max(
    ...o.months.map((m) => Math.max(m.income, m.expense)),
    1
  );

  const kpis = [
    {
      label: "الموجود الآن (صندوق + بنك)",
      value: o.cash,
      icon: "account_balance_wallet",
      color: o.cash >= 0 ? "text-brand-700" : "text-red-700",
      border: "border-r-brand-500",
    },
    {
      label: "قبضنا هذا الشهر",
      value: o.monthIncome,
      icon: "trending_up",
      color: "text-green-700",
      border: "border-r-green-500",
    },
    {
      label: "صرفنا هذا الشهر",
      value: o.monthExpense,
      icon: "trending_down",
      color: "text-red-700",
      border: "border-r-red-500",
    },
    {
      label: "صافي الربح (الكلي)",
      value: o.net,
      icon: "savings",
      color: o.net >= 0 ? "text-green-700" : "text-red-700",
      border: o.net >= 0 ? "border-r-green-500" : "border-r-red-500",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-brand-700">الملخص المالي</h1>
          <p className="text-sm text-gray-500">
            سجّل ما صرفته أو قبضته بجملة بسيطة، والنظام يتكفّل بالباقي.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/accounting/moves/new?dir=صرف"
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            − سجّل صرف
          </Link>
          <Link
            href="/dashboard/accounting/moves/new?dir=قبض"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            + سجّل قبض
          </Link>
        </div>
      </header>

      <AccTabs active="home" />

      <section className="space-y-6 p-6">
        {/* بطاقات الأرقام الأساسية */}
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

        {/* ما على الشركة الآن */}
        {(o.payrollDue > 0.009 || o.partnerDue > 0.009) && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {o.payrollDue > 0.009 && (
              <Link
                href="/dashboard/hr/payroll"
                className="glass-card flex items-center justify-between border-r-4 border-r-amber-500 p-5 transition hover:shadow-md"
              >
                <div>
                  <span className="text-sm text-gray-500">
                    رواتب وعمولات مستحقة للموظفين
                  </span>
                  <p className="mt-1 text-2xl font-bold text-amber-700" dir="ltr">
                    {formatPrice(o.payrollDue)}
                  </p>
                  <span className="text-xs text-gray-400">اضغط للدفع ←</span>
                </div>
                <span className="material-symbols-outlined text-3xl text-amber-400">
                  badge
                </span>
              </Link>
            )}
            {o.partnerDue > 0.009 && (
              <Link
                href="/dashboard/accounting/partners"
                className="glass-card flex items-center justify-between border-r-4 border-r-blue-500 p-5 transition hover:shadow-md"
              >
                <div>
                  <span className="text-sm text-gray-500">مستحق للشركاء (دفعوا من جيبهم)</span>
                  <p className="mt-1 text-2xl font-bold text-blue-700" dir="ltr">
                    {formatPrice(o.partnerDue)}
                  </p>
                  <span className="text-xs text-gray-400">تفاصيل التصفية ←</span>
                </div>
                <span className="material-symbols-outlined text-3xl text-blue-400">
                  handshake
                </span>
              </Link>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* وين تروح فلوسنا */}
          <div className="glass-card p-6 lg:col-span-2">
            <h3 className="text-lg font-bold text-gray-800">وين تروح فلوسنا؟</h3>
            <p className="mb-4 text-sm text-gray-500">
              إجمالي المصاريف:{" "}
              <b className="text-gray-800" dir="ltr">
                {formatPrice(o.expense)}
              </b>{" "}
              دينار
            </p>
            {topCategories.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">
                لا توجد مصاريف مسجّلة بعد.
              </p>
            ) : (
              <div className="space-y-3">
                {topCategories.map((c) => (
                  <div key={c.label}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-gray-700">{c.label}</span>
                      <span className="font-semibold text-gray-800" dir="ltr">
                        {formatPrice(c.amount)}
                        <span className="mr-2 text-xs text-gray-400">
                          {o.expense > 0
                            ? Math.round((c.amount / o.expense) * 100)
                            : 0}
                          %
                        </span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${(c.amount / maxCat) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* الصرف حسب الذراع */}
          <div className="glass-card p-6">
            <h3 className="mb-1 text-lg font-bold text-gray-800">كم يكلّفنا كل ذراع؟</h3>
            <p className="mb-4 text-xs text-gray-400">
              العقارات مقابل التسويق مقابل المصاريف الإدارية.
            </p>
            {o.byArm.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">لا توجد بيانات بعد.</p>
            ) : (
              <div className="space-y-3">
                {o.byArm.map((a) => (
                  <div key={a.label}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          ARM_COLORS[a.label] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {a.label}
                      </span>
                      <span className="font-semibold text-gray-800" dir="ltr">
                        {formatPrice(a.amount)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-brand-600"
                        style={{ width: `${(a.amount / maxArm) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* آخر 6 أشهر */}
        <div className="glass-card p-6">
          <h3 className="mb-4 text-lg font-bold text-gray-800">آخر ٦ أشهر</h3>
          <div className="flex h-48 items-end justify-between gap-3">
            {o.months.map((m, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-40 w-full items-end justify-center gap-1">
                  <div
                    className="w-1/2 rounded-t bg-green-500/80"
                    style={{ height: `${(m.income / maxMonth) * 100}%` }}
                    title={`قبض: ${formatPrice(m.income)}`}
                  />
                  <div
                    className="w-1/2 rounded-t bg-red-400/80"
                    style={{ height: `${(m.expense / maxMonth) * 100}%` }}
                    title={`صرف: ${formatPrice(m.expense)}`}
                  />
                </div>
                <span className="text-xs text-gray-500">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <i className="inline-block h-3 w-3 rounded bg-green-500/80" /> قبضنا
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block h-3 w-3 rounded bg-red-400/80" /> صرفنا
            </span>
          </div>
        </div>

        {/* وضع الشركاء */}
        <div className="glass-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-800">وضع الشركاء</h3>
            <Link
              href="/dashboard/accounting/partners"
              className="text-sm text-brand-700 hover:underline"
            >
              التفاصيل والتصفية ←
            </Link>
          </div>

          {partners.debtor && partners.creditor ? (
            <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-gray-800">
              <b className="text-amber-700">{partners.debtor.name}</b> مدين لـ{" "}
              <b className="text-green-700">{partners.creditor.name}</b> بمبلغ{" "}
              <b className="text-lg" dir="ltr">
                {formatPrice(partners.settleAmount)}
              </b>{" "}
              دينار.
            </p>
          ) : (
            <p className="mb-4 rounded-xl bg-green-50 px-4 py-3 text-green-700">
              ✓ الحسابات بين الشركاء متوازنة — لا أحد مدين للآخر.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {partners.positions.map((p) => (
              <div key={p.id} className="rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-800">{p.name}</span>
                  <span className="text-xs text-gray-400">{p.share_percent}% شراكة</span>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  موّل من حسابه:{" "}
                  <b className="text-gray-800" dir="ltr">
                    {formatPrice(p.fromPocket + p.deposits)}
                  </b>
                </p>
                <p
                  className={`mt-1 font-bold ${
                    p.net >= 0 ? "text-green-700" : "text-red-700"
                  }`}
                  dir="ltr"
                >
                  {p.net >= 0 ? "+" : ""}
                  {formatPrice(p.net)}
                  <span className="mr-2 text-xs font-normal text-gray-500">
                    {p.net > 0.009 ? "(له عند الشركة)" : p.net < -0.009 ? "(عليه)" : "(متوازن)"}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
