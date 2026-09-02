import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import {
  Employee,
  Payroll,
  PayrollLine,
  PayrollPayment,
  formatPrice,
  payrollPayStatus,
} from "@/lib/types";
import PayrollDetail from "@/components/payroll-detail";
import PayPayroll from "../pay-payroll";

// ============================================================
// كشف راتب واحد — صفحته المستقلّة.
//
// كانت الكشوف المعتمدة صفوفاً في جدول لا باب لها: يُقرأ الصافي
// ولا يُعرف ممّ تكوّن، ولا سبيل إلى تعديلها. والقاعدة كانت تسمح
// بإعادة الفتح منذ sql/051 — الناقص كان الزرّ لا الصلاحية.
//
// هنا تُفتح: بنودها، وقرارها، ودفعاتها، ومسار تعديلها قبل الدفع.
// ============================================================
export default async function PayrollPage({
  params,
}: {
  params: { id: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();

  const { data } = await supabase
    .from("payrolls")
    .select("*, employees(id, full_name, job_title)")
    .eq("id", params.id)
    .maybeSingle();

  if (!data) notFound();
  const p = data as Payroll & { employees?: Partial<Employee> | null };

  const [{ data: lineData }, { data: payData }] = await Promise.all([
    supabase
      .from("payroll_lines")
      .select("*")
      .eq("payroll_id", p.id)
      .order("kind")
      .order("created_at"),
    supabase
      .from("payroll_payments")
      .select("*")
      .eq("payroll_id", p.id)
      .order("pay_date", { ascending: false }),
  ]);

  const lines = (lineData ?? []) as PayrollLine[];
  const payments = (payData ?? []) as PayrollPayment[];
  const paid = payments.reduce((s, x) => s + Number(x.amount), 0);
  const st = payrollPayStatus(Number(p.net), paid);

  const name = p.employees?.full_name ?? "موظف";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/hr/payroll"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← كشوف الرواتب
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">
              كشف {name}
            </h1>
            <p className="text-sm text-gray-500" dir="ltr">
              {p.period}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {p.employees?.id && (
            <Link
              href={`/dashboard/hr/employees/${p.employees.id}`}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              ملفّ الموظف
            </Link>
          )}
          {p.state !== "مسودة" && st.remaining > 0 && (
            <PayPayroll
              payrollId={p.id}
              employeeName={name}
              period={p.period}
              remaining={st.remaining}
            />
          )}
        </div>
      </header>

      <section className="space-y-5 p-6">
        {/* الطريق إلى التعديل — يُقال صراحةً لأنه غير بديهي:
            التعديل بعد الاعتماد يمرّ بإعادة الفتح لا بالكتابة فوقه. */}
        {p.state === "معتمد" && paid === 0 && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-gray-700">
            <b className="text-blue-800">تريد تعديل هذا الكشف؟</b> اضغط{" "}
            <b>«إعادة فتح»</b> أدناه — يعود مسوّدةً ويُسحب قيده من الدفاتر،
            فتُضيف البنود وتحذفها بحرّية، ثم تعتمده من جديد. هذا جائز ما دام
            لم يُدفع منه شيء، وبعد أول دفعة يُقفل الباب.
          </div>
        )}

        {p.state === "معتمد" && paid > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-gray-700">
            <b className="text-amber-800">دُفع من هذا الكشف.</b> لم يعد يُعاد
            فتحه — نقدٌ خرج فعلاً من الصندوق وقيدُه في الدفاتر. لتصحيح مبلغ
            بعد الدفع احذف دفعاته أولاً، أو صحّحه في كشف الشهر القادم ببند
            مستقلّ يُبيّن سببه.
          </div>
        )}

        <PayrollDetail payroll={p} lines={lines} paid={paid} canManage />

        {/* الدفعات */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
            <h3 className="font-semibold text-gray-800">الدفعات</h3>
            <span className="text-sm text-gray-500">
              المدفوع{" "}
              <b dir="ltr" className="text-green-700">{formatPrice(paid)}</b>
              {st.remaining > 0 && (
                <>
                  {" · "}المتبقّي{" "}
                  <b dir="ltr" className="text-red-700">
                    {formatPrice(st.remaining)}
                  </b>
                </>
              )}
            </span>
          </div>

          {payments.length === 0 ? (
            <p className="text-sm text-gray-400">
              {p.state === "مسودة"
                ? "الكشف مسوّدة — يُعتمد أولاً ثم يُدفع."
                : "لم تُسجَّل دفعات بعد."}
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {payments.map((x) => (
                <div key={x.id} className="flex items-center gap-3 py-2.5">
                  <span className="material-symbols-outlined text-[18px] text-green-600">
                    {x.method === "بنك" ? "account_balance" : "payments"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-800">
                      {x.method}
                      {x.notes && (
                        <span className="ms-2 text-xs font-normal text-gray-500">
                          {x.notes}
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] text-gray-400" dir="ltr">
                      {x.pay_date}
                    </span>
                  </span>
                  <span
                    className="text-sm font-semibold text-green-700"
                    dir="ltr"
                  >
                    {formatPrice(x.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
