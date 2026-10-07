import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance, canManageHr } from "@/lib/auth";
import { formatPrice } from "@/lib/types";
import ExpenseActions from "./expense-actions";

type Exp = { id: string; employee_id: string; category_code: string; expense_date: string; amount: number;
  description: string; status: string; receipt_path: string | null; paid_at: string | null };

// مصروفات الموظفين (sql/162): HR والمالية. الاعتماد من «موافقاتي»
// (المدير ثم المالية)، والدفع هنا للمالية — كلاهما يكتب قيده في القاعدة.
export default async function ExpensesPage({ searchParams }: { searchParams: { status?: string } }) {
  const [hr, finance] = await Promise.all([canManageHr(), canManageFinance()]);
  if (!hr && !finance) redirect("/dashboard");
  const status = searchParams.status ?? "معتمد";

  const supabase = await createClient();
  const [{ data: rows }, { data: emps }, { data: cats }] = await Promise.all([
    supabase.from("employee_expenses").select("*").eq("status", status).order("expense_date", { ascending: false }).limit(200),
    supabase.from("employees").select("id, full_name"),
    supabase.from("expense_categories").select("code, name_ar"),
  ]);
  const list = (rows ?? []) as Exp[];
  const name = (id: string) => ((emps ?? []) as { id: string; full_name: string }[]).find((e) => e.id === id)?.full_name ?? "—";
  const cat = (c: string) => ((cats ?? []) as { code: string; name_ar: string }[]).find((x) => x.code === c)?.name_ar ?? c;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/hr" className="text-sm text-gray-500 hover:text-brand-700">← الموارد البشرية</Link>
          <h1 className="text-xl font-bold text-brand-700">مصروفات الموظفين</h1>
        </div>
        <nav className="flex gap-1 text-sm">
          {["قيد الموافقة", "معتمد", "مدفوع", "مرفوض"].map((s) => (
            <Link key={s} href={`/dashboard/hr/expenses?status=${encodeURIComponent(s)}`}
              className={`rounded-lg px-3 py-1.5 ${s === status ? "bg-brand-600 text-white" : "border text-gray-600"}`}>{s}</Link>
          ))}
        </nav>
      </header>
      <section className="p-6">
        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-2 text-start font-medium">الموظف</th><th className="px-4 py-2 text-start font-medium">الفئة</th>
                <th className="px-4 py-2 text-start font-medium">التاريخ</th><th className="px-4 py-2 text-start font-medium">المبلغ</th>
                <th className="px-4 py-2 text-start font-medium">البيان</th><th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-400">لا مصروفات بهذه الحالة.</td></tr>}
              {list.map((x) => (
                <tr key={x.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5">{name(x.employee_id)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{cat(x.category_code)}</td>
                  <td className="px-4 py-2.5" dir="ltr">{x.expense_date}</td>
                  <td className="px-4 py-2.5 font-medium" dir="ltr">{formatPrice(x.amount)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{x.description}{x.paid_at && <span className="block text-[11px] text-gray-400">دُفع {x.paid_at}</span>}</td>
                  <td className="px-4 py-2.5 text-end">
                    <ExpenseActions id={x.id} status={x.status} receiptPath={x.receipt_path} canPay={finance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
