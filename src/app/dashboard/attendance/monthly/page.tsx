import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Attendance, CompanySettings, Employee, Leave } from "@/lib/types";
import {
  buildMonth,
  currentMonth,
  effectiveSchedule,
  formatDuration,
  formatDurationShort,
  monthRange,
} from "@/lib/attendance";
import AttendanceTabs from "../attendance-tabs";

// ============================================================
// التقرير الشهري (للمدير) — صف لكل موظف: أيام الحضور والغياب
// والإجازات والتأخير وإجمالي ساعات العمل ونسبة الالتزام.
// ============================================================
export default async function MonthlyAttendancePage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "")
    ? searchParams.month!
    : currentMonth();
  const { start, end } = monthRange(month);

  const supabase = await createClient();
  const [{ data: eData }, { data: aData }, { data: cfg }, { data: lData }] =
    await Promise.all([
      supabase.from("employees").select("*").eq("status", "active").order("full_name"),
      supabase
        .from("attendance")
        .select("*")
        .gte("work_date", start)
        .lte("work_date", end),
      supabase.from("company_settings").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("leaves")
        .select("*")
        .eq("status", "موافق عليها")
        .lte("start_date", end)
        .gte("end_date", start),
    ]);

  const employees = (eData ?? []) as Employee[];
  const records = (aData ?? []) as Attendance[];
  const settings = (cfg as CompanySettings) ?? null;
  const leaves = (lData ?? []) as Leave[];

  // كل موظف يُحسب بدوامه الخاص إن وُجد، وإلا بدوام الشركة
  const rows = employees.map((e) => {
    const schedule = effectiveSchedule(e, settings);
    const { summary } = buildMonth(
      month,
      records.filter((r) => r.employee_id === e.id),
      leaves.filter((l) => l.employee_id === e.id),
      schedule,
      undefined,
      e.exempt_from_attendance
    );
    return { employee: e, summary, schedule };
  });

  // إجماليات الفريق
  const team = rows.reduce(
    (acc, r) => ({
      minutes: acc.minutes + r.summary.totalMinutes,
      absent: acc.absent + r.summary.absentDays,
      late: acc.late + r.summary.lateDays,
      lateMinutes: acc.lateMinutes + r.summary.lateMinutes,
      missingOut: acc.missingOut + r.summary.missingOutDays,
    }),
    { minutes: 0, absent: 0, late: 0, lateMinutes: 0, missingOut: 0 }
  );
  const avgRate =
    rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + r.summary.attendanceRate, 0) / rows.length)
      : 0;

  const kpi = "rounded-2xl border bg-white p-5 shadow-sm";
  const rateColor = (n: number) =>
    n >= 90 ? "text-green-700" : n >= 75 ? "text-amber-600" : "text-red-700";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">التقرير الشهري للدوام</h1>
        </div>
        <form className="flex items-center gap-2">
          <label className="text-sm text-gray-500">الشهر</label>
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
      </header>

      <AttendanceTabs active="monthly" />

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div className={kpi}>
            <span className="text-sm text-gray-500">إجمالي ساعات الفريق</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">
              {Math.round(team.minutes / 60)}{" "}
              <span className="text-sm font-normal text-gray-400">ساعة</span>
            </p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">متوسط الالتزام</span>
            <p className={`mt-1 text-2xl font-bold ${rateColor(avgRate)}`}>{avgRate}%</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">أيام غياب</span>
            <p className="mt-1 text-2xl font-bold text-red-700">{team.absent}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">أيام تأخير</span>
            <p className="mt-1 text-2xl font-bold text-amber-600">{team.late}</p>
            <p className="text-xs text-gray-400">
              بمجموع {formatDuration(team.lateMinutes)}
            </p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">بلا انصراف</span>
            <p className="mt-1 text-2xl font-bold text-amber-700">{team.missingOut}</p>
            <p className="text-xs text-gray-400">نسي تسجيل الانصراف</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا يوجد موظفون نشطون.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full min-w-[1040px] text-right text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الموظف</th>
                  <th className="px-4 py-3 font-medium">أيام الدوام</th>
                  <th className="px-4 py-3 font-medium">حضر</th>
                  <th className="px-4 py-3 font-medium">غاب</th>
                  <th className="px-4 py-3 font-medium">إجازة</th>
                  <th className="px-4 py-3 font-medium">تأخّر</th>
                  <th className="px-4 py-3 font-medium">بلا انصراف</th>
                  <th className="px-4 py-3 font-medium">إجمالي الساعات</th>
                  <th className="px-4 py-3 font-medium">معدّل اليوم</th>
                  <th className="px-4 py-3 font-medium">الالتزام</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ employee: e, summary: s, schedule }) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/attendance/${e.id}?month=${month}`}
                        className="font-medium text-gray-800 hover:text-brand-700"
                      >
                        {e.full_name}
                      </Link>
                      <span className="block text-xs text-gray-400">
                        {e.job_title || "—"}
                      </span>
                      {e.exempt_from_attendance ? (
                        <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                          معفى من البصمة
                        </span>
                      ) : (
                        schedule.custom && (
                          <span
                            className="mt-0.5 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700"
                            dir="ltr"
                          >
                            {schedule.start}–{schedule.end}
                          </span>
                        )
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{s.workDays}</td>
                    <td className="px-4 py-3 font-medium text-green-700">
                      {s.presentDays}
                    </td>
                    <td className="px-4 py-3 font-medium text-red-700">
                      {s.absentDays || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-purple-700">
                      {s.leaveDays || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {s.lateDays ? (
                        <span className="text-amber-700">
                          {s.lateDays}
                          <span className="mr-1 text-xs text-gray-400">
                            ({formatDurationShort(s.lateMinutes)})
                          </span>
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.missingOutDays || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-800">
                      {formatDurationShort(s.totalMinutes)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDurationShort(s.avgMinutes)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={`h-full rounded-full ${
                              s.attendanceRate >= 90
                                ? "bg-green-500"
                                : s.attendanceRate >= 75
                                ? "bg-amber-500"
                                : "bg-red-500"
                            }`}
                            style={{ width: `${Math.min(s.attendanceRate, 100)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-semibold ${rateColor(s.attendanceRate)}`}>
                          {s.attendanceRate}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-left">
                      <Link
                        href={`/dashboard/attendance/${e.id}?month=${month}`}
                        className="whitespace-nowrap text-sm text-brand-700 hover:underline"
                      >
                        السجل
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-gray-400">
          «الالتزام» = (أيام الحضور + أيام الإجازة المعتمدة) ÷ أيام الدوام في الشهر. الأيام
          التي لم تأتِ بعد لا تُحتسب، وكذلك أيام العطلة الأسبوعية.
        </p>
      </section>
    </main>
  );
}
