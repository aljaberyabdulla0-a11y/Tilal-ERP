import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/hr";
import { formatPrice } from "@/lib/types";
import RequestForms from "./request-forms";
import CancelRequest from "./cancel-request";
import ExpenseForm from "./expense-form";
import ResignForm from "./resign-form";

type AttReq = {
  id: string; request_type: string; start_date: string; end_date: string;
  check_in_time: string | null; check_out_time: string | null; reason: string;
  status: string; approval_id: string | null; created_at: string;
};
type OtReq = {
  id: string; work_date: string; start_time: string; end_time: string; hours: number; reason: string;
  compensation: string; status: string; approval_id: string | null; amount: number | null; leave_days: number | null;
};

const STATUS_STYLE: Record<string, string> = {
  "قيد الموافقة": "bg-amber-100 text-amber-700",
  "معتمد": "bg-green-100 text-green-700",
  "مرفوض": "bg-red-100 text-red-700",
  "ملغى": "bg-gray-200 text-gray-600",
  "مدفوع": "bg-emerald-100 text-emerald-700",
};

// طلباتي (sql/154): تعديل بصمة، مهمة، عمل ميداني أو عن بُعد، رحلة عمل،
// وعمل إضافي — كلها تمرّ بسلسلة موافقة، وتُطبَّق بعد الاعتماد في القاعدة.
export default async function MyRequestsPage() {
  const emp = await getMyEmployee();
  if (!emp) redirect("/dashboard/me");

  const supabase = await createClient();
  const [{ data: ars }, { data: ots }, { data: projects }, { data: reqs }, { data: steps }] = await Promise.all([
    supabase.from("attendance_requests").select("*").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("overtime_requests").select("*").eq("employee_id", emp.id).order("work_date", { ascending: false }).limit(50),
    supabase.from("projects").select("id, name").order("name"),
    supabase.from("approval_requests").select("id, workflow_code, current_step").eq("status", "قيد الموافقة")
      .eq("subject_employee", emp.id),
    supabase.from("approval_steps").select("workflow_code, step_no, label"),
  ]);
  // المصروفات والإنهاء (sql/162–163)
  const [{ data: exps }, { data: cats }, { data: terms }] = await Promise.all([
    supabase.from("employee_expenses").select("*").eq("employee_id", emp.id).order("expense_date", { ascending: false }).limit(50),
    supabase.from("expense_categories").select("code, name_ar, requires_receipt").eq("active", true).order("sort_order"),
    supabase.from("termination_requests").select("id, term_type, last_working_day, status, approval_id").eq("employee_id", emp.id)
      .order("created_at", { ascending: false }),
  ]);
  const expenses = (exps ?? []) as { id: string; category_code: string; expense_date: string; amount: number;
    description: string; status: string; approval_id: string | null }[];
  const catName = (c: string) => ((cats ?? []) as { code: string; name_ar: string }[]).find((x) => x.code === c)?.name_ar ?? c;
  const liveTerm = ((terms ?? []) as { id: string; term_type: string; last_working_day: string; status: string; approval_id: string | null }[])
    .find((t) => ["قيد الموافقة", "معتمد"].includes(t.status));

  const stage = (approvalId: string | null) => {
    const r = (reqs ?? []).find((x: { id: string }) => x.id === approvalId) as
      | { workflow_code: string; current_step: number | null } | undefined;
    if (!r) return null;
    if (r.current_step == null) return "المدير";
    return ((steps ?? []) as { workflow_code: string; step_no: number; label: string }[])
      .find((s) => s.workflow_code === r.workflow_code && s.step_no === r.current_step)?.label ?? null;
  };

  const attendance = (ars ?? []) as AttReq[];
  const overtime = (ots ?? []) as OtReq[];
  const statusCell = (status: string, approvalId: string | null) => (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[status] ?? "bg-gray-100"}`}>{status}</span>
      {status === "قيد الموافقة" && stage(approvalId) && <span className="text-[11px] text-gray-500">عند: {stage(approvalId)}</span>}
      {status === "قيد الموافقة" && approvalId && <CancelRequest approvalId={approvalId} />}
    </span>
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/me" className="text-sm text-gray-500 hover:text-brand-700">← بوابتي</Link>
        <h1 className="text-xl font-bold text-brand-700">طلباتي</h1>
      </header>

      <section className="space-y-6 p-6">
        <RequestForms projects={(projects ?? []) as { id: string; name: string }[]} />
        <ExpenseForm
          employeeId={emp.id}
          categories={(cats ?? []) as { code: string; name_ar: string; requires_receipt: boolean }[]}
          projects={(projects ?? []) as { id: string; name: string }[]}
        />

        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-3 font-semibold text-gray-800">مصروفاتي</div>
          {expenses.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">لا مصروفات.</p>
          ) : (
            <table className="w-full min-w-[600px] text-sm">
              <tbody>
                {expenses.map((x) => (
                  <tr key={x.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 text-gray-800">{catName(x.category_code)}</td>
                    <td className="px-4 py-2.5 text-gray-600" dir="ltr">{x.expense_date}</td>
                    <td className="px-4 py-2.5 font-medium" dir="ltr">{formatPrice(x.amount)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{x.description}</td>
                    <td className="px-4 py-2.5">{statusCell(x.status, x.approval_id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-3 font-semibold text-gray-800">طلبات الدوام</div>
          {attendance.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">لا طلبات.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <tbody>
                {attendance.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{a.request_type}</td>
                    <td className="px-4 py-2.5 text-gray-600" dir="ltr">
                      {a.start_date}{a.end_date !== a.start_date ? ` → ${a.end_date}` : ""}
                      {(a.check_in_time || a.check_out_time) &&
                        ` · ${a.check_in_time?.slice(0, 5) ?? "—"} – ${a.check_out_time?.slice(0, 5) ?? "—"}`}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{a.reason}</td>
                    <td className="px-4 py-2.5">{statusCell(a.status, a.approval_id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-3 font-semibold text-gray-800">العمل الإضافي</div>
          {overtime.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">لا طلبات.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <tbody>
                {overtime.map((o) => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 text-gray-800" dir="ltr">{o.work_date} · {o.start_time.slice(0, 5)}–{o.end_time.slice(0, 5)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{o.hours} ساعة · {o.compensation}</td>
                    <td className="px-4 py-2.5 text-gray-600">{o.reason}</td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {o.status === "معتمد" && o.compensation === "أجر" &&
                        (o.amount != null ? <span dir="ltr">{formatPrice(o.amount)}</span> : <span className="text-xs text-gray-400">بانتظار تحديد المعامل</span>)}
                      {o.status === "معتمد" && o.compensation === "إجازة تعويضية" && `${o.leave_days} يوم رصيد`}
                    </td>
                    <td className="px-4 py-2.5">{statusCell(o.status, o.approval_id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          {liveTerm ? (
            <p className="text-sm text-gray-600">
              طلب {liveTerm.term_type} — آخر يوم <span dir="ltr">{liveTerm.last_working_day}</span> · {statusCell(liveTerm.status, liveTerm.approval_id)}
            </p>
          ) : (
            <ResignForm employeeId={emp.id} />
          )}
        </div>
      </section>
    </main>
  );
}
