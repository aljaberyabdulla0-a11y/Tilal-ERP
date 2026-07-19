import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/hr";
import { Leave, LEAVE_STATUS_COLORS } from "@/lib/types";
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
  const { data } = await supabase
    .from("leaves")
    .select("*")
    .eq("employee_id", emp.id)
    .order("created_at", { ascending: false });
  const leaves = (data ?? []) as Leave[];

  return (
    <main className="min-h-screen bg-gray-50">
      {header}
      <section className="space-y-6 p-6">
        <RequestLeave employeeId={emp.id} />

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h3 className="mb-3 text-lg font-semibold text-gray-800">طلباتي</h3>
          {leaves.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد طلبات إجازة.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-right text-sm">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="pb-2 font-medium">النوع</th>
                    <th className="pb-2 font-medium">من</th>
                    <th className="pb-2 font-medium">إلى</th>
                    <th className="pb-2 font-medium">الأيام</th>
                    <th className="pb-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-2.5 text-gray-800">{l.leave_type}</td>
                      <td className="py-2.5 text-gray-600" dir="ltr">{l.start_date}</td>
                      <td className="py-2.5 text-gray-600" dir="ltr">{l.end_date}</td>
                      <td className="py-2.5 text-gray-600">{l.days ?? "—"}</td>
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
      </section>
    </main>
  );
}
