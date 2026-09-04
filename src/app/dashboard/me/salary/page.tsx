import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/hr";
import {
  Payroll,
  PayrollLine,
  PayrollPayment,
  Commission,
  Deduction,
  AdvanceSummary,
  commissionStage,
  formatPrice,
  payrollPayStatus,
} from "@/lib/types";
import PayrollDetail from "@/components/payroll-detail";
import AdvancesPanel from "@/components/advances-panel";

// رواتبي وعمولاتي واستقطاعاتي (للموظف)
export default async function MySalaryPage() {
  const emp = await getMyEmployee();

  const header = (
    <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
      <Link href="/dashboard/me" className="text-sm text-gray-500 hover:text-brand-700">
        ← بوابة الموظف
      </Link>
      <h1 className="text-xl font-bold text-brand-700">رواتبي وعمولاتي</h1>
    </header>
  );

  if (!emp) {
    return (
      <main className="min-h-screen bg-gray-50">
        {header}
        <section className="p-6">
          <div className="rounded-lg bg-amber-50 p-6 text-amber-800">
            لم يتم ربط حسابك بملف موظف بعد.
          </div>
        </section>
      </main>
    );
  }

  const supabase = await createClient();
  const [{ data: pays }, { data: comms }, { data: deds }] = await Promise.all([
    supabase.from("payrolls").select("*").eq("employee_id", emp.id).order("period", { ascending: false }),
    supabase.from("commissions").select("*").eq("employee_id", emp.id).order("comm_date", { ascending: false }),
    supabase.from("deductions").select("*").eq("employee_id", emp.id).order("ded_date", { ascending: false }),
  ]);
  // ⚠️ المسوّدات لا تظهر للموظف: كشفٌ لم يُعتمد بعد أرقامه تتغيّر،
  // وإظهاره يُفهم وعداً برقمٍ قد ينقص غداً.
  const payrolls = ((pays ?? []) as Payroll[]).filter((p) => p.state !== "مسودة");
  const commissions = (comms ?? []) as Commission[];
  const deductions = (deds ?? []) as Deduction[];

  // ما استلمه فعلياً من كل كشف
  const { data: payData } = await supabase
    .from("payroll_payments")
    .select("*")
    .in("payroll_id", payrolls.length ? payrolls.map((p) => p.id) : ["-"]);
  const payments = (payData ?? []) as PayrollPayment[];
  const paidOf = (payrollId: string) =>
    payments
      .filter((x) => x.payroll_id === payrollId)
      .reduce((s, x) => s + Number(x.amount), 0);

  const totalDue = payrolls.reduce(
    (s, p) => s + Math.max(Number(p.net) - paidOf(p.id), 0),
    0
  );

  // سلفي وأقساطها — المتبقّي محسوبٌ في القاعدة
  const { data: advData } = await supabase.rpc("advances_for", { p_employee: emp.id });
  const advances = (advData ?? []) as AdvanceSummary[];

  // بنود آخر كشف — استعلامٌ واحد لأحدث شهر لا لكل الشهور
  const latest = payrolls[0] ?? null;
  const { data: lineData } = latest
    ? await supabase.from("payroll_lines").select("*").eq("payroll_id", latest.id)
    : { data: null };
  const latestLines = (lineData ?? []) as PayrollLine[];

  const card = "rounded-2xl border bg-white p-6 shadow-sm";

  return (
    <main className="min-h-screen bg-gray-50">
      {header}
      <section className="space-y-6 p-6">
        {/* المستحق لي */}
        <div
          className={`rounded-2xl border p-6 shadow-sm ${
            totalDue > 0 ? "bg-amber-50" : "bg-green-50"
          }`}
        >
          <span className="text-sm text-gray-600">المستحق لي (غير مستلم)</span>
          <p
            className={`mt-1 text-3xl font-bold ${
              totalDue > 0 ? "text-amber-700" : "text-green-700"
            }`}
            dir="ltr"
          >
            {formatPrice(totalDue)}
          </p>
          {totalDue <= 0 && (
            <p className="mt-1 text-sm text-green-700">✓ كل رواتبك مستلمة بالكامل.</p>
          )}
        </div>

        {/* قسيمة آخر شهر مفتوحة ببنودها — الموظف يسأل عن هذه أولاً:
            «لماذا نقص راتبي؟» تُجيب البنود لا المجاميع. */}
        {latest && (
          <div>
            <h3 className="mb-3 text-lg font-semibold text-gray-800">
              قسيمة آخر شهر
            </h3>
            <PayrollDetail
              payroll={latest}
              lines={latestLines}
              paid={paidOf(latest.id)}
              canManage={false}
            />
          </div>
        )}

        {/* كشوف الرواتب */}
        <div className={card}>
          <h3 className="mb-3 text-lg font-semibold text-gray-800">كل الكشوف</h3>
          {payrolls.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد كشوف رواتب بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-start text-sm">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="pb-2 font-medium">الشهر</th>
                    <th className="pb-2 font-medium">الأساسي</th>
                    <th className="pb-2 font-medium">البدلات</th>
                    <th className="pb-2 font-medium">العمولات</th>
                    <th className="pb-2 font-medium">الاستقطاعات</th>
                    <th className="pb-2 font-medium">الصافي</th>
                    <th className="pb-2 font-medium">استلمت</th>
                    <th className="pb-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {payrolls.map((p) => {
                    const paid = paidOf(p.id);
                    const st = payrollPayStatus(Number(p.net), paid);
                    return (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-2.5 text-gray-600" dir="ltr">{p.period}</td>
                        <td className="py-2.5" dir="ltr">{formatPrice(p.basic)}</td>
                        <td className="py-2.5" dir="ltr">{formatPrice(p.allowances)}</td>
                        <td className="py-2.5 text-green-700" dir="ltr">{formatPrice(p.commissions_total)}</td>
                        <td className="py-2.5 text-red-700" dir="ltr">{formatPrice(p.deductions_total)}</td>
                        <td className="py-2.5 font-bold" dir="ltr">{formatPrice(p.net)}</td>
                        <td className="py-2.5 text-green-700" dir="ltr">{formatPrice(paid)}</td>
                        <td className="py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.color}`}>
                            {st.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* سلفي — قبل العمولات لأن الموظف يسأل عن ذمّته أولاً */}
        <AdvancesPanel employeeId={emp.id} advances={advances} isAdmin={false} />

        {/* العمولات */}
        <div className={card}>
          <h3 className="mb-1 text-lg font-semibold text-gray-800">عمولاتي</h3>
          {/* الموظف يسأل: «أين عمولتي؟» — والشارة تُجيب بلا مراجعة أحد */}
          <p className="mb-3 text-xs text-gray-400">
            العمولة تُستحقّ لك عند تأكيد مقدمة الصفقة، وتدخل كشف راتبك بعد أن
            تُحصّل الشركة عمولتها من المطوّر.
          </p>
          {commissions.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد عمولات.</p>
          ) : (
            <table className="w-full text-start text-sm">
              <tbody>
                {commissions.map((c) => {
                  const st = commissionStage(c);
                  return (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2 text-gray-600" dir="ltr">{c.comm_date}</td>
                      <td className="py-2 text-gray-800">{c.description || "—"}</td>
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.color}`}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td className="py-2 text-end font-medium text-green-700" dir="ltr">{formatPrice(c.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* الاستقطاعات */}
        <div className={card}>
          <h3 className="mb-3 text-lg font-semibold text-gray-800">استقطاعاتي</h3>
          {deductions.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد استقطاعات.</p>
          ) : (
            <table className="w-full text-start text-sm">
              <tbody>
                {deductions.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 text-gray-600" dir="ltr">{d.ded_date}</td>
                    <td className="py-2 text-gray-800">{d.reason || "—"}</td>
                    <td className="py-2 text-end font-medium text-red-700" dir="ltr">{formatPrice(d.amount)}</td>
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
