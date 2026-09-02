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
  PayrollLine,
  PayrollPayment,
  EmployeeHandover,
  LEAVE_STATUS_COLORS,
  PAYROLL_STATE_COLORS,
  PAYROLL_STATE_HINTS,
  formatPrice,
  formatTime,
  payrollPayStatus,
} from "@/lib/types";
import PayrollDetail from "@/components/payroll-detail";
import PayPayroll from "../../payroll/pay-payroll";
import DeleteEmployeeButton from "../delete-employee-button";
import EndService from "./end-service";
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

  // سجلّ التسليم في الاتجاهين: ما سلّمه وما استلمه
  const { data: hands } = await supabase
    .from("employee_handovers")
    .select("*")
    .or(`from_employee.eq.${id},to_employee.eq.${id}`)
    .order("created_at", { ascending: false });

  // الزملاء النشطون — المرشّحون لاستلام ملفات من تنتهي خدمته
  const { data: peers } = await supabase
    .from("employees")
    .select("*")
    .eq("status", "active")
    .neq("id", id)
    .order("full_name");

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

  // بنود كل الكشوف في استعلام واحد ثم تُوزَّع في الذاكرة —
  // استعلامٌ لكل كشف كان سيعني عشر رحلات شبكة في صفحة واحدة.
  const { data: lineData } = await supabase
    .from("payroll_lines")
    .select("*")
    .in("payroll_id", payrolls.length ? payrolls.map((p) => p.id) : ["-"])
    .order("kind")
    .order("created_at");
  const allLines = (lineData ?? []) as PayrollLine[];
  const linesOf = (payrollId: string) =>
    allLines.filter((l) => l.payroll_id === payrollId);

  // المسوّدة القائمة (إن وُجدت) تُعرض مفتوحة بتفاصيلها، وبقيّة
  // الكشوف في جدول — لأن المسوّدة هي ما يُعمل عليه الآن.
  const draft = payrolls.find((p) => p.state === "مسودة") ?? null;
  const settled = payrolls.filter((p) => p.state !== "مسودة");
  const draftPeriods = payrolls
    .filter((p) => p.state === "مسودة")
    .map((p) => p.period);

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
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/dashboard/hr/employees/${emp.id}/edit`}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            تعديل
          </Link>
          <EndService employee={emp} candidates={(peers ?? []) as Employee[]} />
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
            <div>
              <dt className="text-gray-500">الحالة</dt>
              <dd className="font-medium">
                {emp.status === "active" ? (
                  "على رأس العمل"
                ) : (
                  <span className="text-gray-600">
                    انتهت الخدمة{emp.end_date ? ` — ${emp.end_date}` : ""}
                    {emp.end_reason ? (
                      <span className="block text-xs text-gray-400">{emp.end_reason}</span>
                    ) : null}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        {/* سجلّ التسليم — «أين ذهب عملاء فلان؟» له جواب بعد سنة */}
        {(hands ?? []).length > 0 && (
          <div className={card}>
            <h3 className={h3}>تسليم الملفات</h3>
            <div className="space-y-3">
              {((hands ?? []) as EmployeeHandover[]).map((h) => {
                const outgoing = h.from_employee === emp.id;
                return (
                  <div
                    key={h.id}
                    className={`rounded-xl border border-gray-200 border-s-4 p-4 ${
                      outgoing ? "border-s-red-400" : "border-s-green-500"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="material-symbols-outlined text-[18px] text-gray-400">
                        swap_horiz
                      </span>
                      <span className="font-medium text-gray-800">
                        {outgoing
                          ? `سُلّمت ملفاته إلى ${h.to_name}`
                          : `استلم ملفات ${h.from_name}`}
                      </span>
                      <span className="ms-auto text-xs text-gray-400" dir="ltr">
                        {new Date(h.created_at).toLocaleDateString("en-CA", {
                          timeZone: "Asia/Baghdad",
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      {h.clients_moved} عميلاً · {h.tasks_moved} مهمة ·{" "}
                      {h.reservations_moved} حجزاً
                      {h.note ? ` — ${h.note}` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      بأمر {h.created_by_name ?? "الإدارة"}
                      {h.revoked_access ? " · أُغلق الحساب" : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
                    <td className="py-2 text-gray-800">
                      {c.description || "—"}
                      {/* العمولة الآلية تُميَّز: من يراجع الكشف يعرف ما
                          احتسبه النظام مما أدخله موظف بيده */}
                      {c.auto && (
                        <span className="ms-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                          آلية
                        </span>
                      )}
                    </td>
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
            🔗 الكشف يُبنى <b>مسوّدة</b> لا تمسّ الدفاتر. <b>الاعتماد</b> يسجّله
            دَيناً مستحقاً على الشركة، و<b>الدفع</b> ينقص الصندوق أو البنك —
            كاملاً أو على دفعات.
          </p>
          <div className="mb-4">
            <GeneratePayroll employeeId={emp.id} draftPeriods={draftPeriods} />
          </div>

          {/* المسوّدة القائمة مفتوحة ببنودها — هي ما يُعمل عليه الآن */}
          {draft && (
            <div className="mb-5">
              <PayrollDetail
                payroll={draft}
                lines={linesOf(draft.id)}
                paid={paidOf(draft.id)}
                canManage
              />
            </div>
          )}

          {settled.length === 0 && !draft ? (
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
                    <th className="pb-2 font-medium">الكشف</th>
                    <th className="pb-2 font-medium">الدفع</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {settled.map((p) => {
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
                          <span
                            title={PAYROLL_STATE_HINTS[p.state]}
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              PAYROLL_STATE_COLORS[p.state] ?? "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {p.state}
                          </span>
                        </td>
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
