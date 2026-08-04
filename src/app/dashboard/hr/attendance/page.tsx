import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import {
  Attendance,
  CompanySettings,
  Employee,
  formatDistance,
  formatTime,
} from "@/lib/types";
import ManualStamp from "./manual-stamp";

// ============================================================
// سجل الحضور (للمدير) — يعرض بصمات يوم محدّد لكل الموظفين
// مع بُعد كل بصمة عن مركز المبيعات، ويسمح بالتسجيل اليدوي.
// ============================================================
export default async function HrAttendancePage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();

  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(now.getDate()).padStart(2, "0")}`;
  const date = searchParams.date || todayLocal;

  const [{ data: eData }, { data: aData }, { data: cfg }] = await Promise.all([
    supabase.from("employees").select("*").order("full_name"),
    supabase.from("attendance").select("*").eq("work_date", date),
    supabase.from("company_settings").select("*").eq("id", 1).maybeSingle(),
  ]);

  const employees = (eData ?? []) as Employee[];
  const records = (aData ?? []) as Attendance[];
  const settings = (cfg as CompanySettings) ?? null;

  const recordOf = (employeeId: string) =>
    records.find((r) => r.employee_id === employeeId) ?? null;

  const present = employees.filter((e) => recordOf(e.id)?.check_in).length;
  const absent = employees.length - present;

  const geofenceOn =
    !!settings?.geofence_enabled && settings.office_lat != null;

  const kpi = "rounded-2xl border bg-white p-5 shadow-sm";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/hr" className="text-sm text-gray-500 hover:text-brand-700">
            ← الموارد البشرية
          </Link>
          <h1 className="text-xl font-bold text-brand-700">سجل الحضور</h1>
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

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className={kpi}>
            <span className="text-sm text-gray-500">إجمالي الموظفين</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{employees.length}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">حاضر</span>
            <p className="mt-1 text-2xl font-bold text-green-700">{present}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">لم يبصم</span>
            <p className="mt-1 text-2xl font-bold text-red-700">{absent}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-gray-700">
          {geofenceOn ? (
            <>
              <b className="text-blue-800">تقييد البصمة بالموقع مفعّل.</b> الموظف ما يقدر
              يبصم إلا داخل نطاق {formatDistance(settings!.geofence_radius_m)} من{" "}
              {settings!.office_name}. أنت كمدير تقدر تسجّل يدوياً من هنا بدون قيد الموقع.
            </>
          ) : (
            <>
              <b className="text-blue-800">تقييد البصمة بالموقع غير مفعّل.</b> لتفعيله، اضبط
              موقع مركز المبيعات من{" "}
              <Link href="/dashboard/settings" className="font-semibold underline">
                صفحة الإعدادات
              </Link>
              .
            </>
          )}
        </div>

        {employees.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا يوجد موظفون بعد.{" "}
            <Link href="/dashboard/hr/employees/new" className="text-brand-700 underline">
              أضف موظفاً
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[860px] text-right text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الموظف</th>
                  <th className="px-4 py-3 font-medium">الحضور</th>
                  <th className="px-4 py-3 font-medium">بُعد الحضور</th>
                  <th className="px-4 py-3 font-medium">الانصراف</th>
                  <th className="px-4 py-3 font-medium">بُعد الانصراف</th>
                  <th className="px-4 py-3 font-medium">المصدر</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const r = recordOf(e.id);
                  const dist = (m: number | null | undefined) =>
                    m == null ? (
                      <span className="text-gray-300">—</span>
                    ) : (
                      <span className="text-gray-600">{formatDistance(m)}</span>
                    );
                  return (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">
                        <Link
                          href={`/dashboard/hr/employees/${e.id}`}
                          className="hover:text-brand-700"
                        >
                          {e.full_name}
                        </Link>
                        <span className="block text-xs text-gray-400">
                          {e.job_title || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3" dir="ltr">
                        {r?.check_in ? (
                          <span className="font-medium text-green-700">
                            {formatTime(r.check_in)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{dist(r?.check_in_distance_m)}</td>
                      <td className="px-4 py-3" dir="ltr">
                        {r?.check_out ? (
                          <span className="font-medium text-gray-700">
                            {formatTime(r.check_out)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{dist(r?.check_out_distance_m)}</td>
                      <td className="px-4 py-3">
                        {r?.source ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
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
                        <ManualStamp employeeId={e.id} workDate={date} record={r} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
