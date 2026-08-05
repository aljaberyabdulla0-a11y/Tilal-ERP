import Link from "next/link";
import { redirect } from "next/navigation";
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
  evaluateDay,
  formatDurationShort,
  formatDuration,
  isWorkDay,
  todayISO,
  weekdayName,
} from "@/lib/attendance";
import AttendanceTabs from "./attendance-tabs";
import ManualStamp from "@/components/manual-stamp";

// ============================================================
// دوام اليوم (للمدير) — بصمات يوم محدّد لكل الموظفين مع ساعات
// العمل الفعلية وحالة كل موظف وبُعد بصمته عن مركز المبيعات.
// ============================================================
export default async function AttendanceTodayPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const today = todayISO();
  const date = searchParams.date || today;

  const [{ data: eData }, { data: aData }, { data: cfg }, { data: lData }] =
    await Promise.all([
      supabase.from("employees").select("*").eq("status", "active").order("full_name"),
      supabase.from("attendance").select("*").eq("work_date", date),
      supabase.from("company_settings").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("leaves")
        .select("*")
        .eq("status", "موافق عليها")
        .lte("start_date", date)
        .gte("end_date", date),
    ]);

  const employees = (eData ?? []) as Employee[];
  const records = (aData ?? []) as Attendance[];
  const settings = (cfg as CompanySettings) ?? null;
  const leaves = (lData ?? []) as Leave[];

  // نقيّم كل موظف في هذا اليوم
  const rows = employees.map((e) => {
    const record = records.find((r) => r.employee_id === e.id) ?? null;
    const empLeaves = leaves.filter((l) => l.employee_id === e.id);
    return { employee: e, day: evaluateDay(date, record, empLeaves, settings, today) };
  });

  const present = rows.filter((r) => r.day.record?.check_in).length;
  const working = rows.filter((r) => r.day.status === "working").length;
  const late = rows.filter((r) => r.day.lateMinutes > 0).length;
  const onLeave = rows.filter((r) => r.day.status === "leave").length;
  const absent = rows.filter((r) => r.day.status === "absent").length;
  const totalMinutes = rows.reduce((s, r) => s + (r.day.workedMinutes ?? 0), 0);

  const geofenceOn = !!settings?.geofence_enabled && settings.office_lat != null;
  const workDay = isWorkDay(date, settings);
  const startLabel = (settings?.work_start_time ?? "09:00:00").slice(0, 5);
  const endLabel = (settings?.work_end_time ?? "17:00:00").slice(0, 5);

  const kpi = "rounded-2xl border bg-white p-5 shadow-sm";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">الدوام</h1>
          <span className="text-sm text-gray-400">
            {weekdayName(date)} {date}
          </span>
        </div>
        <form className="flex items-center gap-2">
          <label className="text-sm text-gray-500">التاريخ</label>
          <input
            type="date"
            name="date"
            dir="ltr"
            defaultValue={date}
            className="rounded-lg border border-gray-300 px-3 py-2 text-left text-sm focus:border-brand-500 focus:outline-none"
          />
          <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            عرض
          </button>
        </form>
      </header>

      <AttendanceTabs active="today" />

      <section className="space-y-5 p-6">
        {/* المؤشرات */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          <div className={kpi}>
            <span className="text-sm text-gray-500">الموظفون</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{employees.length}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">حضروا</span>
            <p className="mt-1 text-2xl font-bold text-green-700">{present}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">في الدوام الآن</span>
            <p className="mt-1 text-2xl font-bold text-blue-700">{working}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">متأخرون</span>
            <p className="mt-1 text-2xl font-bold text-amber-600">{late}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">إجازة</span>
            <p className="mt-1 text-2xl font-bold text-purple-700">{onLeave}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">غياب</span>
            <p className="mt-1 text-2xl font-bold text-red-700">{absent}</p>
          </div>
        </div>

        {/* شريط معلومات الدوام */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border bg-white p-4 text-sm text-gray-600">
          <span>
            الدوام الرسمي:{" "}
            <b className="text-gray-800" dir="ltr">
              {startLabel} – {endLabel}
            </b>
          </span>
          <span>
            سماح التأخير: <b className="text-gray-800">{settings?.late_grace_minutes ?? 15} دقيقة</b>
          </span>
          <span>
            إجمالي ساعات العمل اليوم:{" "}
            <b className="text-gray-800">{formatDuration(totalMinutes)}</b>
          </span>
          {!workDay && (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-600">
              هذا اليوم عطلة أسبوعية
            </span>
          )}
          <Link
            href="/dashboard/settings"
            className="text-brand-700 hover:underline"
          >
            تعديل أوقات الدوام
          </Link>
        </div>

        {geofenceOn ? (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-gray-700">
            <b className="text-blue-800">تقييد البصمة بالموقع مفعّل.</b> الموظف ما يقدر يبصم
            إلا داخل نطاق {formatDistance(settings!.geofence_radius_m)} من{" "}
            {settings!.office_name}. أنت كمدير تقدر تسجّل يدوياً من هنا بدون قيد الموقع.
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-gray-700">
            <b className="text-amber-800">تقييد البصمة بالموقع غير مفعّل.</b> لتفعيله اضبط
            موقع مركز المبيعات من{" "}
            <Link href="/dashboard/settings" className="font-semibold underline">
              صفحة الإعدادات
            </Link>
            .
          </div>
        )}

        {employees.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا يوجد موظفون نشطون بعد.{" "}
            <Link href="/dashboard/hr/employees/new" className="text-brand-700 underline">
              أضف موظفاً
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full min-w-[1000px] text-right text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الموظف</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">الحضور</th>
                  <th className="px-4 py-3 font-medium">الانصراف</th>
                  <th className="px-4 py-3 font-medium">ساعات العمل</th>
                  <th className="px-4 py-3 font-medium">التأخير</th>
                  <th className="px-4 py-3 font-medium">المسافة</th>
                  <th className="px-4 py-3 font-medium">المصدر</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ employee: e, day }) => {
                  const r = day.record;
                  return (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/attendance/${e.id}`}
                          className="font-medium text-gray-800 hover:text-brand-700"
                        >
                          {e.full_name}
                        </Link>
                        <span className="block text-xs text-gray-400">
                          {e.job_title || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${day.statusColor}`}
                        >
                          {day.statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3" dir="ltr">
                        {r?.check_in ? (
                          <span
                            className={
                              day.lateMinutes > 0
                                ? "font-medium text-amber-700"
                                : "font-medium text-green-700"
                            }
                          >
                            {formatTime(r.check_in)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3" dir="ltr">
                        {r?.check_out ? (
                          <span className="font-medium text-gray-700">
                            {formatTime(r.check_out)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {day.workedMinutes ? (
                          <span className="font-semibold text-gray-800">
                            {formatDurationShort(day.workedMinutes)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {day.lateMinutes > 0 ? (
                          <span className="text-amber-700">{day.lateMinutes} دقيقة</span>
                        ) : r?.check_in ? (
                          <span className="text-green-600">في الوقت</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {r?.check_in_distance_m != null
                          ? formatDistance(r.check_in_distance_m)
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {r?.source ? (
                          <span
                            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
                              r.source.includes("يدوي")
                                ? "bg-amber-100 text-amber-700"
                                : "bg-green-100 text-green-700"
                            }`}
                          >
                            {r.source}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-left">
                        <ManualStamp
                          employeeId={e.id}
                          workDate={date}
                          record={r}
                          isToday={date === today}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-gray-400">
          «التأخير» يُحتسب بعد تجاوز {settings?.late_grace_minutes ?? 15} دقيقة من الساعة{" "}
          <span dir="ltr">{startLabel}</span>. «الغياب» لا يُسجَّل في أيام العطلة ولا لمن
          عنده إجازة معتمدة.
        </p>
      </section>
    </main>
  );
}
