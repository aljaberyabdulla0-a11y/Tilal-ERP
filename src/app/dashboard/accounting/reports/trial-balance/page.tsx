import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageFinance } from "@/lib/auth";
import { getAccountBalances } from "@/lib/accounting";
import { formatPrice } from "@/lib/types";
import PeriodFilter, { periodLabel, readPeriod } from "../period-filter";

// ميزان المراجعة (Trial Balance) لفترة: افتتاحي + حركة الفترة = ختامي.
// مجموع الأرصدة المدينة = مجموع الدائنة. كل حساب يُفتح على كشفه.
export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams?: { from?: string; to?: string };
}) {
  if (!(await canManageFinance())) redirect("/dashboard");

  const period = readPeriod(searchParams);
  const balances = await getAccountBalances(period);
  // نعرض فقط الحسابات ذات رصيد أو حركة في الفترة
  const rows = balances.filter(
    (a) => a.debit !== 0 || a.credit !== 0 || a.opening !== 0 || a.balance !== 0
  );
  const showOpening = !!period.from;

  let totalDebit = 0;
  let totalCredit = 0;
  let periodDebit = 0;
  let periodCredit = 0;
  rows.forEach((a) => {
    if (a.balance >= 0) totalDebit += a.balance;
    else totalCredit += -a.balance;
    periodDebit += a.debit;
    periodCredit += a.credit;
  });
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const ledgerHref = (code: string) => {
    const q = new URLSearchParams();
    if (period.from) q.set("from", period.from);
    if (period.to) q.set("to", period.to);
    const s = q.toString();
    return `/dashboard/accounting/ledger/${code}${s ? `?${s}` : ""}`;
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/accounting/advanced"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← المحاسبة المتقدمة
        </Link>
        <h1 className="text-xl font-bold text-brand-700">ميزان المراجعة</h1>
        <span className="text-sm text-gray-500">{periodLabel(period)}</span>
      </header>

      <section className="space-y-4 p-6">
        <PeriodFilter basePath="/dashboard/accounting/reports/trial-balance" period={period} />

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا توجد حركات في هذه الفترة.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الحساب</th>
                  {showOpening && <th className="px-4 py-3 font-medium">افتتاحي</th>}
                  <th className="px-4 py-3 font-medium">مدين الفترة</th>
                  <th className="px-4 py-3 font-medium">دائن الفترة</th>
                  <th className="px-4 py-3 font-medium">رصيد مدين</th>
                  <th className="px-4 py-3 font-medium">رصيد دائن</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-800">
                      <Link href={ledgerHref(a.code)} className="hover:text-brand-700 hover:underline">
                        <span className="font-mono text-gray-400" dir="ltr">
                          {a.code}
                        </span>{" "}
                        — {a.name}
                      </Link>
                      {!a.isActive && <span className="ms-2 text-xs text-gray-400">(غير نشط)</span>}
                    </td>
                    {showOpening && (
                      <td className="px-4 py-2.5 text-end text-gray-500" dir="ltr">
                        {a.opening ? formatPrice(a.opening) : "—"}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-end" dir="ltr">
                      {a.debit ? formatPrice(a.debit) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-end" dir="ltr">
                      {a.credit ? formatPrice(a.credit) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-end font-medium" dir="ltr">
                      {a.balance > 0 ? formatPrice(a.balance) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-end font-medium" dir="ltr">
                      {a.balance < 0 ? formatPrice(-a.balance) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold text-gray-800">
                  <td className="px-4 py-3">الإجمالي</td>
                  {showOpening && <td />}
                  <td className="px-4 py-3 text-end" dir="ltr">
                    {formatPrice(periodDebit)}
                  </td>
                  <td className="px-4 py-3 text-end" dir="ltr">
                    {formatPrice(periodCredit)}
                  </td>
                  <td className="px-4 py-3 text-end" dir="ltr">
                    {formatPrice(totalDebit)}
                  </td>
                  <td className="px-4 py-3 text-end" dir="ltr">
                    {formatPrice(totalCredit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className={`text-sm ${balanced ? "text-green-700" : "text-red-600"}`}>
          {balanced
            ? "✓ الميزان متوازن (المدين = الدائن)"
            : "⚠ الميزان غير متوازن — راجع «صحّة المحاسبة»"}
        </p>
      </section>
    </main>
  );
}
