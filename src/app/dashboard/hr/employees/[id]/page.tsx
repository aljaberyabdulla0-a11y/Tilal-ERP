import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import {
  Employee,
  Commission,
  Deduction,
  Leave,
  Attendance,
  Payroll,
  PayrollPayment,
  LEAVE_STATUS_COLORS,
  formatPrice,
  formatTime,
  payrollPayStatus,
} from "@/lib/types";
import PayPayroll from "../../payroll/pay-payroll";
import DeleteEmployeeButton from "../delete-employee-button";
import AddCommission from "./add-commission";
import AddDeduction from "./add-deduction";
import GeneratePayroll from "./generate-payroll";
import LeaveDecision from "../../leave-decision";
import AttendanceSummary from "@/components/attendance-summary";

export default async function EmployeeDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const id = params.id;

  const { data: employee } = await supabase
    .from("employees")
    .select("*")
    .eq("id", id)
    .single();
  if (!employee) notFound();
  const emp = employee as Employee;

  const [{ data: comms }, { data: deds }, { data: lvs }, { data: att }, { data: pays }] =
    await Promise.all([
      supabase.from("commissions").select("*").eq("employee_id", id).order("comm_date", { ascending: false }),
      supabase.from("deductions").select("*").eq("employee_id", id).order("ded_date", { ascending: false }),
      supabase.from("leaves").select("*").eq("employee_id", id).order("created_at", { ascending: false }),
      supabase.from("attendance").select("*").eq("employee_id", id).order("work_date", { ascending: false }).limit(10),
      supabase.from("payrolls").select("*").eq("employee_id", id).order("period", { ascending: false }),
    ]);

  // إجمالي أيام الحضور المسجّلة بالبصمة
  const { count: attCount } = await supabase
    .from("attendance")
    .select("*", { count: "exact", head: true })
    .eq("employee_id", id);

  const commissions = (comms ?? []) as Commission[];
  const deductions = (deds ?? []) as Deduction[];
  const leaves = (lvs ?? []) as Leave[];
  const attendance = (att ?? []) as Attendance[];
  const payrolls = (pays ?? []) as Payroll[];

  // دفعات الرواتب لهذا الموظف — لمعرفة المدفوع والمتبقّي لكل كشف
  const { data: payData } = await supabase
    .from("payroll_payments")
    .select("*")
    .in("payroll_id", payrolls.length ? payrolls.map((p) => p.id) : ["-"]);
  const payrollPayments = (payData ?? []) as PayrollPayment[];
  const paidOf = (payrollId: string) =>
    payrollPayments
      .filter((x) => x.payroll_id === payrollId)
      .reduce((s, x) => s + Number(x.amount), 0);

  // العمولات/الاستقطاعات التي لم تُضمَّن في أي كشف بعد — هي وحدها تدخل الكشف القادم
  const pendingCommissions = commissions.filter((c) => !c.payroll_id);
  const pendingDeductions = deductions.filter((d) => !d.payroll_id);
  const commissionsTotal = pendingCommissions.reduce((s, c) => s + c.amount, 0);
  const deductionsTotal = pendingDeductions.reduce((s, d) => s + d.amount, 0);

  const card = "rounded-2xl border bg-white p-6 shadow-sm";
  const h3 = "mb-3 text-lg font-semibold text-gray-800";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/hr/employees" className="text-sm text-gray-500 hover:text-brand-700">
            ← الموظفون
          </Link>
          <h1 className="text-xl font-bold text-brand-700">{emp.full_name}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/hr/employees/${emp.id}/edit`}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            تعديل
          </Link>
          <DeleteEmployeeButton id={emp.id} name={emp.full_name} />
        </div>
      </header>

      <section className="space-y-6 p-6">
        {/* بيانات الموظف */}
        <div className={card}>
          <h3 className={h3}>البيانات الأساسية</h3>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <div><dt className="text-gray-500">المسمّى الوظيفي</dt><dd className="font-medium">{emp.job_title || "—"}</dd></div>
            <div><dt className="text-gray-500">القسم</dt><dd className="font-medium">{emp.department || "—"}</dd></div>
            <div><dt className="text-gray-500">الهاتف</dt><dd className="font-medium" dir="ltr">{emp.phone || "—"}</dd></div>
            <div><dt className="text-gray-500">تاريخ التعيين</dt><dd className="font-medium" dir="ltr">{emp.hire_date || "—"}</dd></div>
            <div><dt className="text-gray-500">الراتب الأساسي</dt><dd className="font-medium" dir="ltr">{formatPrice(emp.base_salary)}</dd></div>
            <div><dt className="text-gray-500">الحالة</dt><dd className="font-medium">{emp.status === "active" ? "على رأس العمل" : "غير نشط"}</dd></div>
          </dl>
        </div>

        {/* العمولات */}
        <div className={card}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-800">العمولات</h3>
            <span className="text-sm text-gray-500">
              غير محتسبة بكشف: <b dir="ltr">{formatPrice(commissionsTotal)}</b>
            </span>
          </div>
          <div className="mb-2"><AddCommission employeeId={emp.id} /></div>
          <p className="mb-4 text-xs text-gray-400">
            🔗 كل عمولة تصبح مستحقة للموظف في المحاسبة فور إضافتها، وتُدفع مع راتبه.
          </p>
          {commissions.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد عمولات.</p>
          ) : (
            <table className="w-full text-start text-sm">
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 text-gray-600" dir="ltr">{c.comm_date}</td>
                    <td className="py-2 text-gray-800">{c.description || "—"}</td>
                    <td className="py-2">
                      {c.payroll_id ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          مضمّنة بكشف راتب
                        </span>
                      ) : c.journal_entry_id ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                          مستحقة للموظف ✓
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">غير مُرحّلة</span>
                      )}
                    </td>
                    <td className="py-2 text-end font-medium" dir="ltr">{formatPrice(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* الاستقطاعات */}
        <div className={card}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-800">الاستقطاعات</h3>
            <span className="text-sm text-gray-500">
              غير محتسبة بكشف: <b dir="ltr">{formatPrice(deductionsTotal)}</b>
            </span>
          </div>
          <div className="mb-4"><AddDeduction employeeId={emp.id} /></div>
          {deductions.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد استقطاعات.</p>
          ) : (
            <table className="w-full text-start text-sm">
              <tbody>
                {deductions.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 text-gray-600" dir="ltr">{d.ded_date}</td>
                    <td className="py-2 text-gray-800">{d.reason || "—"}</td>
                    <td className="py-2">
                      {d.payroll_id && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          مضمّن بكشف راتب
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-end font-medium" dir="ltr">{formatPrice(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* كشوف الرواتب */}
        <div className={card}>
          <h3 className={h3}>كشوف الرواتب</h3>
          <p className="mb-3 text-xs text-gray-400">
            🔗 توليد الكشف يسجّله كدَين مستحق على الشركة (لا يمسّ الصندوق)، وزر «دفع» ينقص
            الصندوق أو البنك بالمبلغ المدفوع — كاملاً أو على دفعات.
          </p>
          <div className="mb-4">
            <GeneratePayroll
              employeeId={emp.id}
              baseSalary={emp.base_salary}
              commissionsTotal={commissionsTotal}
              deductionsTotal={deductionsTotal}
            />
          </div>
          {payrolls.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد كشوف رواتب.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-start text-sm">
                <thead className="text-gray-500">
                  <tr>
                    <th className="pb-2 font-medium">الشهر</th>
                    <th className="pb-2 font-medium">الأساسي</th>
                    <th className="pb-2 font-medium">العمولات</th>
                    <th className="pb-2 font-medium">الاستقطاعات</th>
                    <th className="pb-2 font-medium">الصافي</th>
                    <th className="pb-2 font-medium">المدفوع</th>
                    <th className="pb-2 font-medium">الحالة</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {payrolls.map((p) => {
                    const paid = paidOf(p.id);
                    const st = payrollPayStatus(Number(p.net), paid);
                    return (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-2 text-gray-600" dir="ltr">
                          {p.period}
                        </td>
                        <td className="py-2" dir="ltr">{formatPrice(p.basic)}</td>
                        <td className="py-2 text-green-700" dir="ltr">{formatPrice(p.commissions_total)}</td>
                        <td className="py-2 text-red-700" dir="ltr">{formatPrice(p.deductions_total)}</td>
                        <td className="py-2 font-bold" dir="ltr">{formatPrice(p.net)}</td>
                        <td className="py-2 text-green-700" dir="ltr">{formatPrice(paid)}</td>
                        <td className="py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.color}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="py-2 text-end">
                          <PayPayroll
                            payrollId={p.id}
                            employeeName={emp.full_name}
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
        </div>

        {/* الإجازات */}
        <div className={card}>
          <h3 className={h3}>الإجازات</h3>
          {leaves.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد إجازات.</p>
          ) : (
            <table className="w-full text-start text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-2 font-medium">النوع</th>
                  <th className="pb-2 font-medium">من</th>
                  <th className="pb-2 font-medium">إلى</th>
                  <th className="pb-2 font-medium">الأيام</th>
                  <th className="pb-2 font-medium">الحالة</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {leaves.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-2 text-gray-800">{l.leave_type}</td>
                    <td className="py-2 text-gray-600" dir="ltr">{l.start_date}</td>
                    <td className="py-2 text-gray-600" dir="ltr">{l.end_date}</td>
                    <td className="py-2 text-gray-600">{l.days ?? "—"}</td>
                    <td className="py-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${LEAVE_STATUS_COLORS[l.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {l.status}
                      </span>
                    </td>
                    <td className="py-2">{l.status === "معلقة" && <LeaveDecision leaveId={l.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ملخص الحضور (يحتسب الفترة قبل النظام دواماً كاملاً) */}
        <AttendanceSummary
          hireDate={emp.hire_date}
          registeredAt={emp.created_at}
          recordedDays={attCount ?? 0}
        />

        {/* آخر سجلات الحضور */}
        <div className={card}>
          <h3 className={h3}>آخر سجلات الحضور</h3>
          {attendance.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد سجلات حضور.</p>
          ) : (
            <table className="w-full text-start text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-2 font-medium">التاريخ</th>
                  <th className="pb-2 font-medium">الحضور</th>
                  <th className="pb-2 font-medium">الانصراف</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 text-gray-600" dir="ltr">{a.work_date}</td>
                    <td className="py-2 text-gray-800" dir="ltr">{formatTime(a.check_in)}</td>
                    <td className="py-2 text-gray-800" dir="ltr">{formatTime(a.check_out)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}
