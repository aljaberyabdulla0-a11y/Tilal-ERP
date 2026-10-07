import Link from "next/link";
import type { HrDashboard } from "@/lib/hr-reports";

// لوحة HR — كل رقم من hr_dashboard (sql/165)، وكل بطاقة تفتح ما وراءها
export default function HrDashboardPanel({ data, error }: { data: HrDashboard | null; error: string | null }) {
  if (!data) {
    return (
      <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
        تعذّر تحميل لوحة HR{error ? `: ${error}` : ""}
      </div>
    );
  }

  const card = (label: string, value: number | string, href?: string, tone: "gray" | "green" | "amber" | "red" = "gray") => {
    const color = { gray: "text-gray-800", green: "text-green-700", amber: "text-amber-600", red: "text-red-600" }[tone];
    const body = (
      <>
        <span className="text-xs text-gray-500">{label}</span>
        <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      </>
    );
    return href ? (
      <Link key={label} href={href} className="rounded-2xl border bg-white p-4 shadow-sm transition hover:border-brand-500">
        {body}
      </Link>
    ) : (
      <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm">{body}</div>
    );
  };
  const warn = (n: number) => (n > 0 ? "amber" : "gray");
  const r = (key: string) => `/dashboard/hr/reports?report=${key}`;
  const maxDept = Math.max(1, ...data.departments.map((d) => d.count));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-600">القوى العاملة</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {card("كل الموظفين", data.total, r("employees"))}
          {card("على رأس العمل", data.active, r("headcount"), "green")}
          {card("غير نشط", data.inactive)}
          {card("تحت التجربة", data.probation, "/dashboard/hr/probation")}
          {card("تعيينات 30 يوماً", data.new_hires, r("hiring"), "green")}
          {card("مغادرات 30 يوماً", data.exits, r("turnover"), data.exits > 0 ? "red" : "gray")}
          {card("منها استقالات", data.resignations, r("turnover"))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-600">اليوم</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {card("حاضرون", data.present_today, "/dashboard/attendance", "green")}
          {card("متأخرون", data.late_today, r("late"), warn(data.late_today))}
          {card("غائبون بلا إجازة", data.absent_today, r("absence"), data.absent_today > 0 ? "red" : "gray")}
          {card("في إجازة", data.on_leave_today, r("leaves"))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-600">ينتظر قراراً</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {card("إجازات معلّقة", data.pending_leaves, "/dashboard/hr/leaves", warn(data.pending_leaves))}
          {card("مصروفات قيد الموافقة", data.pending_expenses, "/dashboard/hr/expenses", warn(data.pending_expenses))}
          {card("مصروفات معتمدة لم تُدفع", data.unpaid_expenses, "/dashboard/hr/expenses", warn(data.unpaid_expenses))}
          {card("سلف معلّقة", data.pending_advances, undefined, warn(data.pending_advances))}
          {card("عمل إضافي قيد الموافقة", data.pending_overtime, r("overtime"), warn(data.pending_overtime))}
          {card("مستندات تنتهي خلال 30 يوماً", data.docs_expiring, r("documents"), data.docs_expiring > 0 ? "red" : "gray")}
          {card("تجربة تنتهي خلال 14 يوماً", data.probation_ending, "/dashboard/hr/probation", warn(data.probation_ending))}
          {card("مراجعات أداء مفتوحة", data.reviews_open, "/dashboard/hr/performance")}
          {card("وظائف مفتوحة", data.open_jobs, "/dashboard/hr/recruitment")}
          {card("إنهاء خدمة جارٍ", data.terminations_open, "/dashboard/hr/offboarding", warn(data.terminations_open))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.payroll_month && (
          <Link href="/dashboard/hr/month-close" className="rounded-2xl border bg-white p-4 shadow-sm transition hover:border-brand-500">
            <h3 className="text-sm font-semibold text-gray-600">كشوف شهر <span dir="ltr">{data.payroll_month.period}</span></h3>
            <div className="mt-3 flex gap-6 text-sm">
              <span>مسودة: <b className="text-amber-600">{data.payroll_month.draft}</b></span>
              <span>معتمد: <b className="text-green-700">{data.payroll_month.approved}</b></span>
              <span>مقفل: <b className="text-gray-800">{data.payroll_month.locked}</b></span>
            </div>
          </Link>
        )}
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-600">النشطون حسب القسم</h3>
          <div className="mt-3 space-y-2">
            {data.departments.map((d) => (
              <div key={d.name} className="flex items-center gap-3 text-sm">
                <span className="w-32 truncate text-gray-700">{d.name}</span>
                <div className="h-2 flex-1 rounded bg-gray-100">
                  <div className="h-2 rounded bg-brand-600" style={{ width: `${(d.count / maxDept) * 100}%` }} />
                </div>
                <span className="w-8 text-left font-semibold text-gray-800">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
