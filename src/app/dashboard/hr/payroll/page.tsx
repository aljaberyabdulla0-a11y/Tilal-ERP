import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import {
  PAYROLL_STATE_COLORS,
  PAYROLL_STATE_HINTS,
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

  // ⚠️ المسوّدات خارج كل مجموع: لم تدخل الدفاتر بعد، فعدّها ديناً
  // على الشركة يُضخّم الالتزام برقمٍ لم يُعتمد.
  const drafts = payrolls.filter((p) => p.state === "مسودة");
  const live = payrolls.filter((p) => p.state !== "مسودة");

  const totalNet = live.reduce((s, p) => s + Number(p.net), 0);
  const totalPaid = live.reduce((s, p) => s + paidOf(p.id), 0);
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
          <b className="text-blue-800">كيف تشتغل الرواتب مع المحاسبة؟</b> الكشف
          يُبنى <b>مسوّدة</b> فلا يمسّ الدفاتر — تراجع بنوده وتُعدّلها بحرّية.
          و<b>الاعتماد</b> هو ما يسجّل الراتب <b>دَيناً على الشركة</b>. وعند
          الضغط على <b>«دفع»</b> ينقص الصندوق أو البنك بالمبلغ المدفوع ويقلّ
          الدَين — كاملاً أو على دفعات. والأرقام أعلاه للمعتمَد وحده.
        </div>

        {/* المسوّدات أولاً: عملٌ لم يُنجَز بعد، لا سجلٌّ يُقرأ */}
        {drafts.length > 0 && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-blue-900">
              <span className="material-symbols-outlined text-[18px]">edit_note</span>
              مسوّدات بانتظار الاعتماد ({drafts.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              {drafts.map((p) => (
                <Link
                  key={p.id}
                  href={`/dashboard/hr/employees/${p.employee_id}`}
                  className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm transition hover:border-brand-400"
                >
                  <b className="text-gray-800">{p.employees?.full_name ?? "—"}</b>
                  <span className="ms-2 text-xs text-gray-400" dir="ltr">
                    {p.period}
                  </span>
                  <span className="ms-2 text-xs font-semibold text-gray-700" dir="ltr">
                    {formatPrice(p.net)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {live.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا كشوف معتمدة بعد. افتح صفحة الموظف من قسم الموظفين، ابنِ مسوّدة
            الكشف، راجع بنودها، ثم اعتمدها.
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
                  <th className="px-4 py-3 font-medium">الكشف</th>
                  <th className="px-4 py-3 font-medium">الدفع</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {live.map((p) => {
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
                          title={PAYROLL_STATE_HINTS[p.state]}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            PAYROLL_STATE_COLORS[p.state] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {p.state}
                        </span>
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
