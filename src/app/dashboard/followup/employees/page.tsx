import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getUserRole } from "@/lib/auth";
import { getProjects, getTeamMembers } from "@/lib/projects";
import {
  Attendance,
  CompanySettings,
  Deduction,
  Leave,
  Task,
  formatPrice,
  formatTime,
  isOpenTask,
} from "@/lib/types";
import {
  effectiveSchedule,
  evaluateDay,
  monthRange,
  currentMonth,
  todayISO,
} from "@/lib/attendance";
import DeductionsManager from "./deductions-manager";

// ============================================================
// «الموظفون» — شاشة مدير المتابعة.
//
// سؤالها: من موجود اليوم، ومن عنده مهام متأخرة، ومن طلب إجازة.
// **قراءة فقط**: لا موافقة على إجازة ولا تعديل ملفّ ولا راتب —
// وهذا ليس إخفاءً في الواجهة فقط، بل ما تسمح به سياسات القاعدة
// (sql/040): جدول employees نفسه محجوب عنه، والمعروض هنا من
// المنظور الآمن team_members الذي لا يحوي الرواتب أصلاً.
// ============================================================
export default async function FollowupEmployeesPage() {
  const role = await getUserRole();
  // المدير له شاشاته الكاملة في HR، وهذه مخصّصة لمدير المتابعة
  if (role !== "followup_manager" && role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const today = todayISO();
  const { start, end } = monthRange(currentMonth());

  const [
    user,
    members,
    projects,
    { data: attData },
    { data: leaveData },
    { data: taskData },
    { data: cfg },
    { data: dedData },
  ] =
    await Promise.all([
      getCurrentUser(),
      getTeamMembers(),
      getProjects(),
      supabase.from("attendance").select("*").eq("work_date", today),
      supabase
        .from("leaves")
        .select("*")
        .gte("start_date", start)
        .lte("start_date", end)
        .order("start_date"),
      supabase
        .from("tasks")
        .select("*")
        .in("status", ["جديدة", "قيد التنفيذ"])
        .limit(500),
      supabase.from("company_settings").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("deductions")
        .select("*")
        .gte("ded_date", start)
        .lte("ded_date", end)
        .order("ded_date", { ascending: false }),
    ]);

  const attendance = (attData ?? []) as Attendance[];
  const leaves = (leaveData ?? []) as Leave[];
  const tasks = (taskData ?? []) as Task[];
  const settings = (cfg as CompanySettings) ?? null;
  const deductions = (dedData ?? []) as Deduction[];

  const active = members.filter((m) => m.status === "active");
  const projectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.name ?? "—";

  // حالة كل موظف اليوم — بجدول دوامه هو إن كان له جدول خاص
  const rows = active.map((m) => {
    const record = attendance.find((a) => a.employee_id === m.id) ?? null;
    const myLeaves = leaves.filter((l) => l.employee_id === m.id);
    const day = evaluateDay(
      today,
      record,
      myLeaves,
      effectiveSchedule(m, settings),
      today,
      m.exempt_from_attendance ?? false
    );
    const myTasks = m.user_id
      ? tasks.filter((t) => t.assigned_to === m.user_id && isOpenTask(t.status))
      : [];

    return {
      member: m,
      day,
      record,
      openTasks: myTasks.length,
      lateTasks: myTasks.filter((t) => t.due_date < today).length,
      monthLeaves: myLeaves.filter((l) => l.status === "موافق عليها").length,
      monthDeductions: deductions
        .filter((d) => d.employee_id === m.id)
        .reduce((s, d) => s + Number(d.amount), 0),
    };
  });

  const present = rows.filter(
    (r) => r.day.status === "working" || r.day.status === "complete"
  ).length;
  const onLeave = rows.filter((r) => r.day.status === "leave").length;
  const absent = rows.filter((r) => r.day.status === "absent").length;
  const pending = leaves.filter((l) => l.status === "معلقة");
  const totalLate = rows.reduce((s, r) => s + r.lateTasks, 0);

  // ملفّي أنا — لأمنع الخصم على النفس في القائمة كما تمنعه القاعدة
  const myEmployeeId = members.find((m) => m.user_id === user?.id)?.id ?? null;
  const monthLabel = new Date().toLocaleDateString("ar", {
    month: "long",
    year: "numeric",
  });

  const kpi = "glass-card border-s-4 p-5";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">الموظفون</h1>
            <p className="text-sm text-gray-500">
              الحضور والإجازات والمهام المفتوحة — متابعة يومية.
            </p>
          </div>
        </div>
      </header>

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div className={kpi + " border-s-brand-500"}>
            <span className="text-sm text-gray-500">الموظفون</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{active.length}</p>
          </div>
          <div className={kpi + " border-s-green-500"}>
            <span className="text-sm text-gray-500">حاضرون اليوم</span>
            <p className="mt-1 text-2xl font-bold text-green-700">{present}</p>
          </div>
          <div className={kpi + " border-s-blue-500"}>
            <span className="text-sm text-gray-500">في إجازة</span>
            <p className="mt-1 text-2xl font-bold text-blue-700">{onLeave}</p>
          </div>
          <div className={kpi + (absent ? " border-s-red-500" : " border-s-gray-300")}>
            <span className="text-sm text-gray-500">غياب بلا بصمة</span>
            <p
              className={`mt-1 text-2xl font-bold ${
                absent ? "text-red-700" : "text-gray-500"
              }`}
            >
              {absent}
            </p>
          </div>
          <div className={kpi + (totalLate ? " border-s-amber-500" : " border-s-gray-300")}>
            <span className="text-sm text-gray-500">مهام متأخرة</span>
            <p
              className={`mt-1 text-2xl font-bold ${
                totalLate ? "text-amber-700" : "text-gray-500"
              }`}
            >
              {totalLate}
            </p>
          </div>
        </div>

        {/* طلبات إجازة معلّقة — للعلم لا للقرار */}
        {pending.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-700">event_busy</span>
              <b className="text-amber-800">
                طلبات إجازة معلّقة ({pending.length})
              </b>
            </div>
            <p className="mb-3 text-xs text-amber-700">
              القرار للمدير أو مشرف المشروع — هذه للمتابعة فقط.
            </p>
            <div className="space-y-2">
              {pending.map((l) => {
                const who = members.find((m) => m.id === l.employee_id);
                return (
                  <div
                    key={l.id}
                    className="rounded-xl border border-amber-100 bg-white px-4 py-2 text-sm"
                  >
                    <b className="text-gray-800">{who?.full_name ?? "—"}</b>
                    <span className="text-gray-500">
                      {" · "}
                      {l.leave_type} · {l.start_date}
                      {l.end_date !== l.start_date && ` ← ${l.end_date}`}
                    </span>
                    {l.reason && (
                      <span className="block text-xs text-gray-400">{l.reason}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* جدول الموظفين */}
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا يوجد موظفون فعّالون.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">الموظف</th>
                  <th className="px-4 py-3 text-start font-medium">المسمى</th>
                  <th className="px-4 py-3 text-start font-medium">المشروع</th>
                  <th className="px-4 py-3 text-start font-medium">حالة اليوم</th>
                  <th className="px-4 py-3 text-start font-medium">دخول / خروج</th>
                  <th className="px-4 py-3 text-start font-medium">مهام مفتوحة</th>
                  <th className="px-4 py-3 text-start font-medium">متأخرة</th>
                  <th className="px-4 py-3 text-start font-medium">إجازات الشهر</th>
                  <th className="px-4 py-3 text-start font-medium">خصومات الشهر</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.member.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-800">
                      {r.member.full_name}
                      {r.member.phone && (
                        <span className="block text-xs font-normal text-gray-400" dir="ltr">
                          {r.member.phone}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {r.member.job_title ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {projectName(r.member.project_id)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${r.day.statusColor}`}
                      >
                        {r.day.statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">
                      {r.record?.check_in ? formatTime(r.record.check_in) : "—"}
                      {" / "}
                      {r.record?.check_out ? formatTime(r.record.check_out) : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.openTasks}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          r.lateTasks
                            ? "rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700"
                            : "text-gray-400"
                        }
                      >
                        {r.lateTasks || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.monthLeaves}</td>
                    <td className="px-4 py-3" dir="ltr">
                      {r.monthDeductions ? (
                        <span className="font-bold text-red-700">
                          {formatPrice(r.monthDeductions)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* الاستقطاعات — تُحتسب في كشف الراتب القادم (sql/041) */}
        <DeductionsManager
          employees={members}
          deductions={deductions}
          myEmployeeId={myEmployeeId}
          myUserId={user?.id ?? ""}
          isAdmin={role === "admin"}
          monthLabel={monthLabel}
        />
      </section>
    </main>
  );
}
