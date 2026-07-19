import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getAccountBalances, computeNetProfit } from "@/lib/accounting";
import { formatPrice } from "@/lib/types";

// الصفحة الرئيسية للمحاسبة — ملخص + روابط للأقسام
export default async function AccountingHome() {
  if (!(await isAdmin())) redirect("/dashboard");

  const balances = await getAccountBalances();
  const netProfit = computeNetProfit(balances);
  const cash = balances
    .filter((a) => a.code === "1100" || a.code === "1200")
    .reduce((s, a) => s + a.balance, 0);
  const revenue = balances
    .filter((a) => a.type === "revenue")
    .reduce((s, a) => s + (a.credit - a.debit), 0);
  const expense = balances
    .filter((a) => a.type === "expense")
    .reduce((s, a) => s + (a.debit - a.credit), 0);

  const sections = [
    {
      href: "/dashboard/accounting/entries",
      title: "قيود اليومية",
      desc: "تسجيل وعرض كل العمليات المالية",
      icon: "🧾",
    },
    {
      href: "/dashboard/accounting/accounts",
      title: "شجرة الحسابات",
      desc: "دليل حسابات الشركة",
      icon: "🌳",
    },
    {
      href: "/dashboard/accounting/reports/trial-balance",
      title: "ميزان المراجعة",
      desc: "أرصدة الحسابات (مدين = دائن)",
      icon: "⚖️",
    },
    {
      href: "/dashboard/accounting/reports/income-statement",
      title: "قائمة الدخل",
      desc: "الإيرادات − المصروفات = الربح",
      icon: "📈",
    },
    {
      href: "/dashboard/accounting/reports/balance-sheet",
      title: "الميزانية العمومية",
      desc: "الأصول = الالتزامات + حقوق الملكية",
      icon: "📊",
    },
    {
      href: "/dashboard/accounting/partners",
      title: "الشركاء والتصفية",
      desc: "مصاريف الشركاء ومن مدين لمن",
      icon: "🤝",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">المحاسبة</h1>
        </div>
        <Link
          href="/dashboard/accounting/entries/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + قيد جديد
        </Link>
      </header>

      <section className="p-6">
        {/* ملخص سريع */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <span className="text-sm text-gray-500">النقد والبنك</span>
            <p className="mt-2 text-2xl font-bold text-gray-800" dir="ltr">
              {formatPrice(cash)}
            </p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <span className="text-sm text-gray-500">إجمالي الإيرادات</span>
            <p className="mt-2 text-2xl font-bold text-green-700" dir="ltr">
              {formatPrice(revenue)}
            </p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <span className="text-sm text-gray-500">إجمالي المصروفات</span>
            <p className="mt-2 text-2xl font-bold text-red-700" dir="ltr">
              {formatPrice(expense)}
            </p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <span className="text-sm text-gray-500">صافي الربح</span>
            <p
              className={`mt-2 text-2xl font-bold ${
                netProfit >= 0 ? "text-green-700" : "text-red-700"
              }`}
              dir="ltr"
            >
              {formatPrice(netProfit)}
            </p>
          </div>
        </div>

        {/* أقسام المحاسبة */}
        <h3 className="mt-8 text-lg font-semibold text-gray-700">الأقسام</h3>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="rounded-2xl border bg-white p-6 shadow-sm transition hover:border-brand-500 hover:shadow-md"
            >
              <div className="text-3xl">{s.icon}</div>
              <h4 className="mt-3 text-lg font-semibold text-gray-800">{s.title}</h4>
              <p className="mt-1 text-sm text-gray-500">{s.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
