import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import {
  Attendance,
  CompanySettings,
  Employee,
  Leave,
  formatDistance,
  formatTime,
} from "@/lib/types";
import {
  buildMonth,
  currentMonth,
  effectiveSchedule,
  formatDuration,
  formatDurationShort,
  monthRange,
  todayISO,
  weekdayName,
} from "@/lib/attendance";
import ManualStamp from "@/components/manual-stamp";

// ============================================================
// سجل دوام موظف واحد — كل يوم في الشهر بحالته وساعاته،
// مع إمكانية تصحيح البصمة يدوياً من نفس الصف.
// ============================================================
export default async function EmployeeAttendancePage({
  params,
  searchParams,
}: {
  params: { employeeId: string };
  searchParams: { month?: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "")
    ? searchParams.month!
    : currentMonth();
  const { start, end } = monthRange(month);
  const today = todayISO();

  const supabase = await createClient();
  const [{ data: eData }, { data: aData }, { data: cfg }, { data: lData }] =
    await Promise.all([
      supabase.from("employees").select("*").eq("id", params.employeeId).single(),
      supabase
        .from("attendance")
        .select("*")
        .eq("employee_id", params.employeeId)
        .gte("work_date", start)
        .lte("work_date", end),
      supabase.from("company_settings").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("leaves")
        .select("*")
        .eq("employee_id", params.employeeId)
        .eq("status", "موافق عليها")
        .lte("start_date", end)
        .gte("end_date", start),
    ]);

  if (!eData) notFound();
  const employee = eData as Employee;
  const settings = (cfg as CompanySettings) ?? null;

  const schedule = effectiveSchedule(employee, settings);
  const { days, summary } = buildMonth(
    month,
    (aData ?? []) as Attendance[],
    (lData ?? []) as Leave[],
    schedule,
    today,
    employee.exempt_from_attendance
  );

  const kpi = "rounded-2xl border bg-white p-5 shadow-sm";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/attendance/monthly?month=${month}`}
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← التقرير الشهري
          </Link>
          <h1 className="text-xl font-bold text-brand-700">
            سجل دوام: {employee.full_name}
          </h1>
          {employee.exempt_from_attendance ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              معفى من البصمة
            </span>
          ) : (
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                schedule.custom
                  ? "bg-brand-50 text-brand-700"
                  : "bg-gray-100 text-gray-600"
              }`}
              dir="ltr"
            >
              {schedule.start}–{schedule.end}
            </span>
          )}
          <span className="text-sm text-gray-400">{employee.job_title || "—"}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/hr/employees/${employee.id}`}
            className="text-sm text-brand-700 hover:underline"
          >
            ملف الموظف
          </Link>
          <form className="flex items-center gap-2">
            <input
              type="month"
              name="month"
              dir="ltr"
              defaultValue={month}
              className="rounded-lg border border-gray-300 px-3 py-2 text-left text-sm focus:border-brand-500 focus:outline-none"
            />
            <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
              عرض
            </button>
          </form>
        </div>
      </header>

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div className={kpi}>
            <span className="text-sm text-gray-500">إجمالي الساعات</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">
              {formatDurationShort(summary.totalMinutes)}
            </p>
            <p className="text-xs text-gray-400">{formatDuration(summary.totalMinutes)}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">أيام الحضور</span>
            <p className="mt-1 text-2xl font-bold text-green-700">
              {summary.presentDays}
              <span className="text-sm font-normal text-gray-400">
                {" "}
                / {summary.workDays}
              </span>
            </p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">أيام الغياب</span>
            <p className="mt-1 text-2xl font-bold text-red-700">{summary.absentDays}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">أيام التأخير</span>
            <p className="mt-1 text-2xl font-bold text-amber-600">{summary.lateDays}</p>
            <p className="text-xs text-gray-400">{formatDuration(summary.lateMinutes)}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">معدّل اليوم</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">
              {formatDurationShort(summary.avgMinutes)}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <table className="w-full min-w-[940px] text-right text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">اليوم</th>
                <th className="px-4 py-3 font-medium">الحالة</th>
                <th className="px-4 py-3 font-medium">الحضور</th>
                <th className="px-4 py-3 font-medium">الانصراف</th>
                <th className="px-4 py-3 font-medium">ساعات العمل</th>
                <th className="px-4 py-3 font-medium">التأخير</th>
                <th className="px-4 py-3 font-medium">المسافة</th>
                <th className="px-4 py-3 font-medium">ملاحظة</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr
                  key={d.date}
                  className={`border-b last:border-0 ${
                    d.status === "off" ? "bg-gray-50/60" : "hover:bg-gray-50"
                  }`}
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-800" dir="ltr">
                      {d.date}
                    </span>
                    <span className="block text-xs text-gray-400">
                      {weekdayName(d.date)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${d.statusColor}`}
                    >
                      {d.statusLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3" dir="ltr">
                    {d.record?.check_in ? (
                      <span
                        className={
                          d.lateMinutes > 0 ? "text-amber-700" : "text-green-700"
                        }
                      >
                        {formatTime(d.record.check_in)}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700" dir="ltr">
                    {d.record?.check_out ? (
                      formatTime(d.record.check_out)
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-800">
                    {d.workedMinutes ? (
                      formatDurationShort(d.workedMinutes)
                    ) : (
                      <span className="font-normal text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {d.lateMinutes > 0 ? (
                      <span className="text-amber-700">{d.lateMinutes} دقيقة</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {d.record?.check_in_distance_m != null
                      ? formatDistance(d.record.check_in_distance_m)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {d.status === "leave" && d.leave
                      ? `إجازة ${d.leave.leave_type}`
                      : d.record?.source?.includes("يدوي")
                      ? "تسجيل يدوي"
                      : d.record?.note || "—"}
                  </td>
                  <td className="px-4 py-3 text-left">
                    {d.status !== "off" && (
                      <ManualStamp
                        employeeId={employee.id}
                        workDate={d.date}
                        record={d.record}
                        isToday={d.date === today}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {days.length === 0 && (
          <p className="text-center text-sm text-gray-400">لا توجد أيام في هذا الشهر بعد.</p>
        )}
      </section>
    </main>
  );
}
