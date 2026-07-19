import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Leave, LEAVE_STATUS_COLORS } from "@/lib/types";
import LeaveDecision from "../leave-decision";

// كل طلبات الإجازات (للمدير)
export default async function HrLeavesPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("leaves")
    .select("*, employees(full_name)")
    .order("created_at", { ascending: false });

  const leaves = (data ?? []) as Leave[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/hr" className="text-sm text-gray-500 hover:text-brand-700">
          ← الموارد البشرية
        </Link>
        <h1 className="text-xl font-bold text-brand-700">طلبات الإجازات</h1>
      </header>

      <section className="p-6">
        {leaves.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا توجد طلبات إجازة.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-right text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الموظف</th>
                  <th className="px-4 py-3 font-medium">النوع</th>
                  <th className="px-4 py-3 font-medium">من</th>
                  <th className="px-4 py-3 font-medium">إلى</th>
                  <th className="px-4 py-3 font-medium">الأيام</th>
                  <th className="px-4 py-3 font-medium">السبب</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {leaves.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {l.employees?.full_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{l.leave_type}</td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">{l.start_date}</td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">{l.end_date}</td>
                    <td className="px-4 py-3 text-gray-600">{l.days ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{l.reason || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${LEAVE_STATUS_COLORS[l.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {l.status === "معلقة" && <LeaveDecision leaveId={l.id} />}
                    </td>
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
