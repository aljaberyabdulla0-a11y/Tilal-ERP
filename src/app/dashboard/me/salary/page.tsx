import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/hr";
import { Payroll, Commission, Deduction, formatPrice } from "@/lib/types";

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
  const payrolls = (pays ?? []) as Payroll[];
  const commissions = (comms ?? []) as Commission[];
  const deductions = (deds ?? []) as Deduction[];

  const card = "rounded-2xl border bg-white p-6 shadow-sm";

  return (
    <main className="min-h-screen bg-gray-50">
      {header}
      <section className="space-y-6 p-6">
        {/* كشوف الرواتب */}
        <div className={card}>
          <h3 className="mb-3 text-lg font-semibold text-gray-800">كشوف الرواتب</h3>
          {payrolls.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد كشوف رواتب بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-right text-sm">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="pb-2 font-medium">الشهر</th>
                    <th className="pb-2 font-medium">الأساسي</th>
                    <th className="pb-2 font-medium">البدلات</th>
                    <th className="pb-2 font-medium">العمولات</th>
                    <th className="pb-2 font-medium">الاستقطاعات</th>
                    <th className="pb-2 font-medium">الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {payrolls.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2.5 text-gray-600" dir="ltr">{p.period}</td>
                      <td className="py-2.5" dir="ltr">{formatPrice(p.basic)}</td>
                      <td className="py-2.5" dir="ltr">{formatPrice(p.allowances)}</td>
                      <td className="py-2.5 text-green-700" dir="ltr">{formatPrice(p.commissions_total)}</td>
                      <td className="py-2.5 text-red-700" dir="ltr">{formatPrice(p.deductions_total)}</td>
                      <td className="py-2.5 font-bold" dir="ltr">{formatPrice(p.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* العمولات */}
        <div className={card}>
          <h3 className="mb-3 text-lg font-semibold text-gray-800">عمولاتي</h3>
          {commissions.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد عمولات.</p>
          ) : (
            <table className="w-full text-right text-sm">
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 text-gray-600" dir="ltr">{c.comm_date}</td>
                    <td className="py-2 text-gray-800">{c.description || "—"}</td>
                    <td className="py-2 text-left font-medium text-green-700" dir="ltr">{formatPrice(c.amount)}</td>
                  </tr>
                ))}
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
            <table className="w-full text-right text-sm">
              <tbody>
                {deductions.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 text-gray-600" dir="ltr">{d.ded_date}</td>
                    <td className="py-2 text-gray-800">{d.reason || "—"}</td>
                    <td className="py-2 text-left font-medium text-red-700" dir="ltr">{formatPrice(d.amount)}</td>
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
