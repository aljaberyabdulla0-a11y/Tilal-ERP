import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getAccountBalances } from "@/lib/accounting";
import { formatPrice } from "@/lib/types";

// قائمة الدخل (Income Statement): الإيرادات - المصروفات = صافي الربح
export default async function IncomeStatementPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const balances = await getAccountBalances();

  const revenues = balances
    .filter((a) => a.type === "revenue")
    .map((a) => ({ ...a, amount: a.credit - a.debit }))
    .filter((a) => a.amount !== 0);
  const expenses = balances
    .filter((a) => a.type === "expense")
    .map((a) => ({ ...a, amount: a.debit - a.credit }))
    .filter((a) => a.amount !== 0);

  const totalRevenue = revenues.reduce((s, a) => s + a.amount, 0);
  const totalExpense = expenses.reduce((s, a) => s + a.amount, 0);
  const netProfit = totalRevenue - totalExpense;

  const Section = ({
    title,
    rows,
    total,
    totalLabel,
  }: {
    title: string;
    rows: { id: string; code: string; name: string; amount: number }[];
    total: number;
    totalLabel: string;
  }) => (
    <div className="rounded-lg border bg-white shadow-sm">
      <div className="border-b bg-gray-50 px-4 py-2 font-semibold text-gray-700">
        {title}
      </div>
      <table className="w-full text-start text-sm">
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-4 py-3 text-gray-400">لا يوجد</td>
            </tr>
          ) : (
            rows.map((a) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="px-4 py-2.5 text-gray-800">{a.name}</td>
                <td className="w-40 px-4 py-2.5 text-end" dir="ltr">
                  {formatPrice(a.amount)}
                </td>
              </tr>
            ))
          )}
          <tr className="border-t font-semibold text-gray-700">
            <td className="px-4 py-2.5">{totalLabel}</td>
            <td className="px-4 py-2.5 text-end" dir="ltr">
              {formatPrice(total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/accounting/advanced"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← المحاسبة المتقدمة
        </Link>
        <h1 className="text-xl font-bold text-brand-700">قائمة الدخل</h1>
      </header>

      <section className="max-w-2xl space-y-5 p-6">
        <Section
          title="الإيرادات"
          rows={revenues}
          total={totalRevenue}
          totalLabel="إجمالي الإيرادات"
        />
        <Section
          title="المصروفات"
          rows={expenses}
          total={totalExpense}
          totalLabel="إجمالي المصروفات"
        />

        {/* صافي الربح */}
        <div
          className={`rounded-lg border p-5 shadow-sm ${
            netProfit >= 0 ? "bg-green-50" : "bg-red-50"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-gray-700">
              {netProfit >= 0 ? "صافي الربح" : "صافي الخسارة"}
            </span>
            <span
              className={`text-2xl font-bold ${
                netProfit >= 0 ? "text-green-700" : "text-red-700"
              }`}
              dir="ltr"
            >
              {formatPrice(netProfit)}
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
