import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getAccountBalances, computeNetProfit } from "@/lib/accounting";
import { formatPrice } from "@/lib/types";
import AccTabs from "../acc-tabs";

// ============================================================
// المحاسبة المتقدمة — للمحاسب أو المدقّق.
// كل ما هنا يُبنى تلقائياً من الحركات المالية المبسّطة،
// فلا حاجة لاستخدامه في العمل اليومي.
// ============================================================
export default async function AdvancedAccounting() {
  if (!(await isAdmin())) redirect("/dashboard");

  const balances = await getAccountBalances();
  const netProfit = computeNetProfit(balances);
  const revenue = balances
    .filter((a) => a.type === "revenue")
    .reduce((s, a) => s + (a.credit - a.debit), 0);
  const expense = balances
    .filter((a) => a.type === "expense")
    .reduce((s, a) => s + (a.debit - a.credit), 0);
  const partnerDue = balances
    .filter((a) => a.code === "2500")
    .reduce((s, a) => s + (a.credit - a.debit), 0);

  const sections = [
    {
      href: "/dashboard/accounting/entries",
      title: "قيود اليومية",
      desc: "كل القيود المحاسبية، بما فيها المُولَّدة تلقائياً",
      icon: "receipt_long",
    },
    {
      href: "/dashboard/accounting/entries/new",
      title: "قيد يدوي",
      desc: "للحالات الخاصة التي لا تغطيها الحركات المبسّطة",
      icon: "edit_note",
    },
    {
      href: "/dashboard/accounting/accounts",
      title: "شجرة الحسابات",
      desc: "دليل حسابات الشركة",
      icon: "account_tree",
    },
    {
      href: "/dashboard/accounting/reports/trial-balance",
      title: "ميزان المراجعة",
      desc: "أرصدة الحسابات (مدين = دائن)",
      icon: "balance",
    },
    {
      href: "/dashboard/accounting/reports/income-statement",
      title: "قائمة الدخل",
      desc: "الإيرادات − المصروفات = الربح",
      icon: "trending_up",
    },
    {
      href: "/dashboard/accounting/reports/balance-sheet",
      title: "الميزانية العمومية",
      desc: "الأصول = الالتزامات + حقوق الملكية",
      icon: "pie_chart",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold text-brand-700">المحاسبة المتقدمة</h1>
        <p className="text-sm text-gray-500">
          الدفاتر والتقارير المعيارية — تُبنى تلقائياً من حركاتك المالية.
        </p>
      </header>

      <AccTabs active="advanced" />

      <section className="space-y-6 p-6">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-gray-700">
          <b className="text-blue-800">ما تحتاج تفتح هذا القسم في عملك اليومي.</b> كل حركة
          تسجّلها في تبويب «الحركات المالية» تتحوّل هنا إلى قيد محاسبي صحيح تلقائياً. هذا القسم
          موجود لمحاسبك أو المدقّق.
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="glass-card p-5">
            <span className="text-sm text-gray-500">إجمالي الإيرادات</span>
            <p className="mt-2 text-2xl font-bold text-green-700" dir="ltr">
              {formatPrice(revenue)}
            </p>
          </div>
          <div className="glass-card p-5">
            <span className="text-sm text-gray-500">إجمالي المصروفات</span>
            <p className="mt-2 text-2xl font-bold text-red-700" dir="ltr">
              {formatPrice(expense)}
            </p>
          </div>
          <div className="glass-card p-5">
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
          <div className="glass-card p-5">
            <span className="text-sm text-gray-500">مستحق للشركاء (جاري الشركاء)</span>
            <p className="mt-2 text-2xl font-bold text-gray-800" dir="ltr">
              {formatPrice(partnerDue)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="glass-card p-6 transition hover:border-brand-500 hover:shadow-md"
            >
              <span className="material-symbols-outlined text-3xl text-brand-600">
                {s.icon}
              </span>
              <h4 className="mt-3 text-lg font-semibold text-gray-800">{s.title}</h4>
              <p className="mt-1 text-sm text-gray-500">{s.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
