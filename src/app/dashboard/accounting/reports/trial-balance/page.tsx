import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getAccountBalances } from "@/lib/accounting";
import { formatPrice } from "@/lib/types";

// ميزان المراجعة (Trial Balance) — يجب أن يتساوى مجموع المدين والدائن
export default async function TrialBalancePage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const balances = await getAccountBalances();
  // نعرض فقط الحسابات ذات الحركة
  const rows = balances.filter((a) => a.debit !== 0 || a.credit !== 0);

  let totalDebit = 0;
  let totalCredit = 0;
  rows.forEach((a) => {
    if (a.balance >= 0) totalDebit += a.balance;
    else totalCredit += -a.balance;
  });

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/accounting"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← المحاسبة
        </Link>
        <h1 className="text-xl font-bold text-brand-700">ميزان المراجعة</h1>
      </header>

      <section className="p-6">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا توجد حركات بعد.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[500px] text-right text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الحساب</th>
                  <th className="px-4 py-3 font-medium">رصيد مدين</th>
                  <th className="px-4 py-3 font-medium">رصيد دائن</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 text-gray-800">
                      <span className="font-mono text-gray-400" dir="ltr">
                        {a.code}
                      </span>{" "}
                      — {a.name}
                    </td>
                    <td className="px-4 py-2.5 text-left" dir="ltr">
                      {a.balance > 0 ? formatPrice(a.balance) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-left" dir="ltr">
                      {a.balance < 0 ? formatPrice(-a.balance) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold text-gray-800">
                  <td className="px-4 py-3">الإجمالي</td>
                  <td className="px-4 py-3 text-left" dir="ltr">
                    {formatPrice(totalDebit)}
                  </td>
                  <td className="px-4 py-3 text-left" dir="ltr">
                    {formatPrice(totalCredit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p
          className={`mt-3 text-sm ${
            totalDebit === totalCredit ? "text-green-700" : "text-red-600"
          }`}
        >
          {totalDebit === totalCredit
            ? "✓ الميزان متوازن (المدين = الدائن)"
            : "⚠ الميزان غير متوازن — راجع القيود"}
        </p>
      </section>
    </main>
  );
}
