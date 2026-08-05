import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getMyEmployee } from "@/lib/hr";
import {
  Attendance,
  CompanySettings,
  Payroll,
  WorkLocation,
  formatPrice,
} from "@/lib/types";
import { baghdadDate } from "@/lib/time";
import CheckInOut from "./check-in-out";
import HrTabs from "../hr/hr-tabs";
import AttendanceSummary from "@/components/attendance-summary";

// بوابة الموظف — الصفحة الرئيسية
export default async function MyPortalHome() {
  const [emp, admin] = await Promise.all([getMyEmployee(), isAdmin()]);

  // المستخدم غير مرتبط بملف موظف
  if (!emp) {
    return (
      <main className="min-h-screen bg-gray-50">
        <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">HR</h1>
        </header>
        <HrTabs active="portal" isAdmin={admin} />
        <section className="p-6">
          <div className="rounded-2xl bg-amber-50 p-6 text-amber-900">
            <h3 className="font-bold">حسابك غير مربوط بملف موظف</h3>
            <p className="mt-1 text-sm">
              تسجيل البصمة يعمل فقط لحساب مرتبط بملف موظف — لذلك لا يظهر لك زر البصمة.
            </p>
            {admin ? (
              <div className="mt-4 space-y-2 text-sm">
                <p className="font-semibold">بما أنك مدير، تقدر تحلّها بطريقتين:</p>
                <p>
                  <b>١)</b> لتبصم أنت بنفسك: افتح{" "}
                  <Link
                    href="/dashboard/hr/employees"
                    className="font-semibold underline hover:text-amber-700"
                  >
                    الموظفين
                  </Link>{" "}
                  ← أنشئ ملف موظف باسمك (أو عدّل ملفاً موجوداً) واربطه بحسابك من حقل
                  &laquo;الربط بحساب دخول&raquo;.
                </p>
                <p>
                  <b>٢)</b> لتسجّل الحضور نيابة عن الموظفين: افتح{" "}
                  <Link
                    href="/dashboard/hr/attendance"
                    className="font-semibold underline hover:text-amber-700"
                  >
                    سجل الحضور
                  </Link>{" "}
                  وسجّل لهم يدوياً بدون قيد الموقع.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm">
                راجع المدير لإنشاء ملفك وربطه بحسابك.
              </p>
            )}
          </div>
        </section>
      </main>
    );
  }

  const supabase = await createClient();
  // يوم البصمة بتوقيت بغداد (خادم Vercel يعمل بـ UTC فلا نعتمد عليه)
  const today = baghdadDate();

  const [
    { data: todayAtt },
    { data: comms },
    { data: deds },
    { data: pays },
    { data: cfg },
    { data: locs },
  ] = await Promise.all([
      supabase
        .from("attendance")
        .select("*")
        .eq("employee_id", emp.id)
        .eq("work_date", today)
        .maybeSingle(),
      supabase.from("commissions").select("amount").eq("employee_id", emp.id),
      supabase.from("deductions").select("amount").eq("employee_id", emp.id),
      supabase
        .from("payrolls")
        .select("*")
        .eq("employee_id", emp.id)
        .order("period", { ascending: false })
        .limit(1),
      supabase.from("company_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("work_locations").select("*").eq("is_active", true),
    ]);

  const commissionsTotal = (comms ?? []).reduce(
    (s: number, c: { amount: number }) => s + c.amount,
    0
  );
  const deductionsTotal = (deds ?? []).reduce(
    (s: number, d: { amount: number }) => s + d.amount,
    0
  );
  const lastPayroll = ((pays ?? []) as Payroll[])[0] ?? null;

  // إجمالي أيام الحضور المسجّلة بالبصمة
  const { count: attCount } = await supabase
    .from("attendance")
    .select("*", { count: "exact", head: true })
    .eq("employee_id", emp.id);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">HR</h1>
        </div>
        <span className="text-sm text-gray-600">{emp.full_name}</span>
      </header>

      <HrTabs active="portal" isAdmin={admin} />

      <section className="space-y-6 p-6">
        {/* تسجيل البصمة — المعفيّون (الإدارة) لا يظهر لهم */}
        {emp.exempt_from_attendance ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h3 className="font-semibold text-slate-800">معفى من البصمة</h3>
            <p className="mt-1 text-sm text-slate-600">
              حسابك معفى من تسجيل الحضور، فلا يُحتسب عليك غياب ولا تأخير.
            </p>
          </div>
        ) : (
          <CheckInOut
            employeeId={emp.id}
            todayRecord={(todayAtt as Attendance) ?? null}
            settings={(cfg as CompanySettings) ?? null}
            locations={(locs ?? []) as WorkLocation[]}
          />
        )}

        {/* ملخص الحضور */}
        <AttendanceSummary
          hireDate={emp.hire_date}
          registeredAt={emp.created_at}
          recordedDays={attCount ?? 0}
        />

        {/* ملخص سريع */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <span className="text-sm text-gray-500">الراتب الأساسي</span>
            <p className="mt-2 text-xl font-bold text-gray-800" dir="ltr">{formatPrice(emp.base_salary)}</p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <span className="text-sm text-gray-500">إجمالي عمولاتي</span>
            <p className="mt-2 text-xl font-bold text-green-700" dir="ltr">{formatPrice(commissionsTotal)}</p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <span className="text-sm text-gray-500">إجمالي الاستقطاعات</span>
            <p className="mt-2 text-xl font-bold text-red-700" dir="ltr">{formatPrice(deductionsTotal)}</p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <span className="text-sm text-gray-500">آخر راتب صافٍ</span>
            <p className="mt-2 text-xl font-bold text-gray-800" dir="ltr">
              {lastPayroll ? formatPrice(lastPayroll.net) : "—"}
            </p>
          </div>
        </div>

        {/* روابط */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/dashboard/me/salary"
            className="rounded-2xl border bg-white p-6 shadow-sm transition hover:border-brand-500 hover:shadow-md"
          >
            <div className="text-3xl">💵</div>
            <h3 className="mt-3 text-lg font-semibold text-gray-800">رواتبي وعمولاتي</h3>
            <p className="mt-1 text-sm text-gray-500">كشوف الرواتب والعمولات والاستقطاعات</p>
          </Link>
          <Link
            href="/dashboard/me/leaves"
            className="rounded-2xl border bg-white p-6 shadow-sm transition hover:border-brand-500 hover:shadow-md"
          >
            <div className="text-3xl">🏖️</div>
            <h3 className="mt-3 text-lg font-semibold text-gray-800">إجازاتي</h3>
            <p className="mt-1 text-sm text-gray-500">طلب إجازة ومتابعة الطلبات</p>
          </Link>
        </div>
      </section>
    </main>
  );
}
