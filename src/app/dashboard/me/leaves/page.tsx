import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/hr";
import {
  Leave,
  LeaveBalance,
  LeaveLedgerEntry,
  LEAVE_LEDGER_ICONS,
  LEAVE_STATUS_COLORS,
  formatDays,
  formatLeaveDuration,
  formatLeavePeriod,
} from "@/lib/types";
import RequestLeave from "./request-leave";

// إجازاتي (للموظف)
export default async function MyLeavesPage() {
  const emp = await getMyEmployee();

  const header = (
    <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
      <Link href="/dashboard/me" className="text-sm text-gray-500 hover:text-brand-700">
        ← بوابة الموظف
      </Link>
      <h1 className="text-xl font-bold text-brand-700">إجازاتي</h1>
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
  const [{ data }, { data: balData }, { data: ledgerData }] = await Promise.all([
    supabase
      .from("leaves")
      .select("*")
      .eq("employee_id", emp.id)
      .order("created_at", { ascending: false }),
    // ⚠️ الرصيد يأتي من القاعدة محسوباً — لا يُجمع في المتصفّح
    supabase.rpc("leave_balances_for", { p_employee: emp.id }),
    supabase
      .from("leave_ledger")
      .select("*")
      .eq("employee_id", emp.id)
      .order("entry_date", { ascending: false })
      .limit(20),
  ]);

  const leaves = (data ?? []) as Leave[];
  const balances = (balData ?? []) as LeaveBalance[];
  const ledger = (ledgerData ?? []) as LeaveLedgerEntry[];

  return (
    <main className="min-h-screen bg-gray-50">
      {header}
      <section className="space-y-6 p-6">
        {/* رصيدي — أول ما يسأل عنه الموظف قبل أن يطلب */}
        {balances.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {balances.map((b) => (
              <div
                key={b.leave_type_id}
                className={`glass-card border-s-4 p-5 ${
                  b.deducts_salary
                    ? "border-s-red-400"
                    : b.balance > 0
                    ? "border-s-green-500"
                    : "border-s-gray-300"
                }`}
              >
                <span className="text-sm text-gray-500">{b.type_name}</span>
                {b.requires_balance ? (
                  <>
                    <p
                      className={`mt-1 text-2xl font-bold ${
                        b.balance > 0 ? "text-green-700" : "text-gray-500"
                      }`}
                    >
                      {formatDays(b.balance)}{" "}
                      <span className="text-sm font-normal text-gray-400">يوم متبقٍّ</span>
                    </p>
                    <p className="mt-1 text-[11px] text-gray-400">
                      استُحقّ {formatDays(b.accrued)} · استُهلك {formatDays(b.used)} ·
                      المستحَقّ السنوي {formatDays(b.entitled)}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-gray-500">
                    {b.deducts_salary
                      ? "تُخصم من الراتب — بلا رصيد"
                      : "بلا رصيد محدَّد"}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <RequestLeave employeeId={emp.id} />

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h3 className="mb-3 text-lg font-semibold text-gray-800">طلباتي</h3>
          {leaves.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد طلبات إجازة.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-start text-sm">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="pb-2 font-medium">النوع</th>
                    <th className="pb-2 font-medium">المدّة</th>
                    <th className="pb-2 font-medium">الفترة</th>
                    <th className="pb-2 font-medium">المقدار</th>
                    <th className="pb-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-2.5 text-gray-800">{l.leave_type}</td>
                      <td className="py-2.5">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            l.duration_type === "ساعات"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {l.duration_type === "ساعات" ? "زمنية" : "يوم كامل"}
                        </span>
                      </td>
                      <td className="py-2.5 text-gray-600" dir="ltr">
                        {formatLeavePeriod(l)}
                      </td>
                      <td className="py-2.5 text-gray-600">{formatLeaveDuration(l)}</td>
                      <td className="py-2.5">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${LEAVE_STATUS_COLORS[l.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {l.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* حركة الرصيد — «من أين جاء رصيدي وأين ذهب» */}
        {ledger.length > 0 && (
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h3 className="mb-1 text-lg font-semibold text-gray-800">حركة رصيدي</h3>
            <p className="mb-3 text-xs text-gray-400">
              الرصيد ليس رقماً مكتوباً — هو مجموع هذه الحركات.
            </p>
            <div className="divide-y divide-gray-100">
              {ledger.map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className={`material-symbols-outlined text-[18px] ${
                      e.days > 0 ? "text-green-600" : "text-red-500"
                    }`}
                  >
                    {LEAVE_LEDGER_ICONS[e.kind] ?? "circle"}
                  </span>
                  <span className="w-24 shrink-0 text-xs text-gray-500" dir="ltr">
                    {e.entry_date}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                    {e.note || e.kind}
                  </span>
                  <span
                    className={`shrink-0 text-sm font-semibold ${
                      e.days > 0 ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {e.days > 0 ? "+" : "−"} {formatDays(Math.abs(e.days))} يوم
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
