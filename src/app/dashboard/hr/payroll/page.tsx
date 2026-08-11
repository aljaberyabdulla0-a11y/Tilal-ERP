import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import {
  Payroll,
  PayrollPayment,
  formatPrice,
  payrollPayStatus,
} from "@/lib/types";
import PayPayroll from "./pay-payroll";

type PayrollRow = Payroll & { employees?: { full_name: string } | null };

// ============================================================
// كشوف الرواتب — الاستحقاق والدفع.
// توليد الكشف = استحقاق (دَين على الشركة)، وزر «دفع» = صرف فعلي
// ينقص الصندوق أو البنك ويقلّل الدَين، كاملاً أو جزئياً.
// ============================================================
export default async function HrPayrollPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: pData }, { data: payData }] = await Promise.all([
    supabase
      .from("payrolls")
      .select("*, employees(full_name)")
      .order("period", { ascending: false }),
    supabase.from("payroll_payments").select("*"),
  ]);

  const payrolls = (pData ?? []) as unknown as PayrollRow[];
  const payments = (payData ?? []) as PayrollPayment[];

  const paidOf = (payrollId: string) =>
    payments
      .filter((p) => p.payroll_id === payrollId)
      .reduce((s, p) => s + Number(p.amount), 0);

  const totalNet = payrolls.reduce((s, p) => s + Number(p.net), 0);
  const totalPaid = payrolls.reduce((s, p) => s + paidOf(p.id), 0);
  const totalDue = Math.max(totalNet - totalPaid, 0);

  const kpi = "rounded-2xl border bg-white p-5 shadow-sm";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/hr" className="text-sm text-gray-500 hover:text-brand-700">
          ← الموارد البشرية
        </Link>
        <h1 className="text-xl font-bold text-brand-700">كشوف الرواتب</h1>
      </header>

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className={kpi}>
            <span className="text-sm text-gray-500">إجمالي الرواتب المستحقة</span>
            <p className="mt-1 text-2xl font-bold text-gray-800" dir="ltr">
              {formatPrice(totalNet)}
            </p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">المدفوع فعلياً</span>
            <p className="mt-1 text-2xl font-bold text-green-700" dir="ltr">
              {formatPrice(totalPaid)}
            </p>
          </div>
          <div className={`${kpi} ${totalDue > 0 ? "border-s-4 border-s-red-500" : ""}`}>
            <span className="text-sm text-gray-500">المتبقّي على الشركة</span>
            <p
              className={`mt-1 text-2xl font-bold ${
                totalDue > 0 ? "text-red-700" : "text-green-700"
              }`}
              dir="ltr"
            >
              {formatPrice(totalDue)}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-gray-700">
          <b className="text-blue-800">كيف تشتغل الرواتب مع المحاسبة؟</b> توليد كشف الراتب
          يسجّل الراتب كـ<b> دَين على الشركة</b> ولا يمسّ الصندوق. عند الضغط على{" "}
          <b>«دفع»</b> ينقص الصندوق أو البنك بالمبلغ المدفوع فقط ويقلّ الدَين — تقدر تدفع
          الراتب كاملاً أو على دفعات.
        </div>

        {payrolls.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا توجد كشوف رواتب بعد. افتح صفحة الموظف من قسم الموظفين ثم استخدم
            &quot;توليد كشف الراتب&quot;.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الموظف</th>
                  <th className="px-4 py-3 font-medium">الشهر</th>
                  <th className="px-4 py-3 font-medium">الأساسي</th>
                  <th className="px-4 py-3 font-medium">العمولات</th>
                  <th className="px-4 py-3 font-medium">الاستقطاعات</th>
                  <th className="px-4 py-3 font-medium">الصافي</th>
                  <th className="px-4 py-3 font-medium">المدفوع</th>
                  <th className="px-4 py-3 font-medium">المتبقّي</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {payrolls.map((p) => {
                  const paid = paidOf(p.id);
                  const st = payrollPayStatus(Number(p.net), paid);
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {p.employees?.full_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600" dir="ltr">
                        {p.period}
                      </td>
                      <td className="px-4 py-3" dir="ltr">
                        {formatPrice(p.basic)}
                      </td>
                      <td className="px-4 py-3 text-green-700" dir="ltr">
                        {formatPrice(p.commissions_total)}
                      </td>
                      <td className="px-4 py-3 text-red-700" dir="ltr">
                        {formatPrice(p.deductions_total)}
                      </td>
                      <td className="px-4 py-3 font-bold text-gray-800" dir="ltr">
                        {formatPrice(p.net)}
                      </td>
                      <td className="px-4 py-3 text-green-700" dir="ltr">
                        {formatPrice(paid)}
                      </td>
                      <td
                        className={`px-4 py-3 font-medium ${
                          st.remaining > 0 ? "text-red-700" : "text-gray-400"
                        }`}
                        dir="ltr"
                      >
                        {formatPrice(st.remaining)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${st.color}`}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <PayPayroll
                          payrollId={p.id}
                          employeeName={p.employees?.full_name ?? ""}
                          period={p.period}
                          remaining={st.remaining}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
