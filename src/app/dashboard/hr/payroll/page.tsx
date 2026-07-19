import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Payroll, formatPrice } from "@/lib/types";

type PayrollRow = Payroll & { employees?: { full_name: string } | null };

// كل كشوف الرواتب (للمدير) — تُولّد من صفحة الموظف
export default async function HrPayrollPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("payrolls")
    .select("*, employees(full_name)")
    .order("period", { ascending: false });

  const payrolls = (data ?? []) as PayrollRow[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/hr" className="text-sm text-gray-500 hover:text-brand-700">
          ← الموارد البشرية
        </Link>
        <h1 className="text-xl font-bold text-brand-700">كشوف الرواتب</h1>
      </header>

      <section className="p-6">
        <p className="mb-4 text-sm text-gray-500">
          لتوليد كشف راتب، افتح صفحة الموظف من قسم الموظفين ثم استخدم &quot;توليد كشف الراتب&quot;.
        </p>

        {payrolls.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا توجد كشوف رواتب بعد.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[720px] text-right text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الموظف</th>
                  <th className="px-4 py-3 font-medium">الشهر</th>
                  <th className="px-4 py-3 font-medium">الأساسي</th>
                  <th className="px-4 py-3 font-medium">العمولات</th>
                  <th className="px-4 py-3 font-medium">الاستقطاعات</th>
                  <th className="px-4 py-3 font-medium">الصافي</th>
                </tr>
              </thead>
              <tbody>
                {payrolls.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {p.employees?.full_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">{p.period}</td>
                    <td className="px-4 py-3" dir="ltr">{formatPrice(p.basic)}</td>
                    <td className="px-4 py-3 text-green-700" dir="ltr">{formatPrice(p.commissions_total)}</td>
                    <td className="px-4 py-3 text-red-700" dir="ltr">{formatPrice(p.deductions_total)}</td>
                    <td className="px-4 py-3 font-bold text-gray-800" dir="ltr">{formatPrice(p.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
