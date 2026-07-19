import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getAccountBalances, computeNetProfit } from "@/lib/accounting";
import { formatPrice } from "@/lib/types";

// الميزانية العمومية (Balance Sheet): الأصول = الالتزامات + حقوق الملكية
export default async function BalanceSheetPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const balances = await getAccountBalances();
  const netProfit = computeNetProfit(balances);

  const assets = balances
    .filter((a) => a.type === "asset")
    .map((a) => ({ ...a, amount: a.debit - a.credit }))
    .filter((a) => a.amount !== 0);
  const liabilities = balances
    .filter((a) => a.type === "liability")
    .map((a) => ({ ...a, amount: a.credit - a.debit }))
    .filter((a) => a.amount !== 0);
  const equity = balances
    .filter((a) => a.type === "equity")
    .map((a) => ({ ...a, amount: a.credit - a.debit }))
    .filter((a) => a.amount !== 0);

  const totalAssets = assets.reduce((s, a) => s + a.amount, 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + a.amount, 0);
  // حقوق الملكية = رأس المال + الأرباح المحتجزة + صافي ربح الفترة الحالية
  const totalEquity = equity.reduce((s, a) => s + a.amount, 0) + netProfit;
  const totalLiabEquity = totalLiabilities + totalEquity;
  const balanced = Math.abs(totalAssets - totalLiabEquity) < 0.01;

  const Section = ({
    title,
    rows,
    total,
    extraRow,
  }: {
    title: string;
    rows: { id: string; name: string; amount: number }[];
    total: number;
    extraRow?: { label: string; amount: number };
  }) => (
    <div className="rounded-lg border bg-white shadow-sm">
      <div className="border-b bg-gray-50 px-4 py-2 font-semibold text-gray-700">
        {title}
      </div>
      <table className="w-full text-right text-sm">
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b last:border-0">
              <td className="px-4 py-2.5 text-gray-800">{a.name}</td>
              <td className="w-40 px-4 py-2.5 text-left" dir="ltr">
                {formatPrice(a.amount)}
              </td>
            </tr>
          ))}
          {extraRow && (
            <tr className="border-b last:border-0">
              <td className="px-4 py-2.5 text-gray-800">{extraRow.label}</td>
              <td className="px-4 py-2.5 text-left" dir="ltr">
                {formatPrice(extraRow.amount)}
              </td>
            </tr>
          )}
          <tr className="border-t font-semibold text-gray-700">
            <td className="px-4 py-2.5">الإجمالي</td>
            <td className="px-4 py-2.5 text-left" dir="ltr">
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
          href="/dashboard/accounting"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← المحاسبة
        </Link>
        <h1 className="text-xl font-bold text-brand-700">الميزانية العمومية</h1>
      </header>

      <section className="p-6">
        <div className="grid max-w-4xl grid-cols-1 gap-5 lg:grid-cols-2">
          <Section title="الأصول" rows={assets} total={totalAssets} />
          <div className="space-y-5">
            <Section
              title="الالتزامات"
              rows={liabilities}
              total={totalLiabilities}
            />
            <Section
              title="حقوق الملكية"
              rows={equity}
              total={totalEquity}
              extraRow={{ label: "صافي ربح الفترة", amount: netProfit }}
            />
          </div>
        </div>

        <div
          className={`mt-5 max-w-4xl rounded-lg border p-4 text-sm ${
            balanced ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
          }`}
        >
          {balanced ? "✓ " : "⚠ "}
          الأصول ({formatPrice(totalAssets)}) = الالتزامات + حقوق الملكية (
          {formatPrice(totalLiabEquity)})
        </div>
      </section>
    </main>
  );
}
