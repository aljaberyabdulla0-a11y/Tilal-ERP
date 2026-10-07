import Link from "next/link";
import { redirect } from "next/navigation";
import { getHrDashboard } from "@/lib/hr-reports";
import { canManageHr, isAdmin } from "@/lib/auth";
import HrTabs from "./hr-tabs";
import HrDashboardPanel from "./hr-dashboard-panel";

// الصفحة الرئيسية للموارد البشرية (للمدير) — غير المدير يُحوّل لبوابة الموظف
export default async function HrHome() {
  if (!(await canManageHr())) redirect("/dashboard/me");

  // مؤشرات اللوحة من القاعدة (sql/165) — لا عدّ في المتصفح
  const { data: dash, error: dashError } = await getHrDashboard();

  const sections = [
    { href: "/dashboard/hr/reports", title: "التقارير", desc: "17 تقريراً: الدوام والغياب والرواتب والدوران والأداء… بتصدير Excel وPDF", icon: "📈" },
    { href: "/dashboard/hr/employees", title: "الموظفون", desc: "بيانات الموظفين والرواتب", icon: "🧑‍💼" },
    { href: "/dashboard/hr/organization", title: "الهيكل التنظيمي", desc: "الإدارات والأقسام والفرق ومدراؤها، ولوحة كل قسم", icon: "🏢" },
    { href: "/dashboard/hr/positions", title: "المناصب والدرجات", desc: "المسمّيات الوظيفية وتبعيّتها، والدرجات ونطاق رواتبها", icon: "🪪" },
    { href: "/dashboard/hr/recruitment", title: "التوظيف", desc: "طلبات التوظيف، الوظائف، المرشحون والمقابلات والعروض", icon: "🧲" },
    { href: "/dashboard/hr/onboarding", title: "التهيئة", desc: "مهام الموظفين الجدد — تُنجز تلقائياً ما تحقّقت منه القاعدة", icon: "🧭" },
    { href: "/dashboard/hr/probation", title: "فترة التجربة", desc: "تقييم المدير وHR، ثم التثبيت أو التمديد أو الإنهاء", icon: "⏳" },
    { href: "/dashboard/hr/performance", title: "الأداء والأهداف", desc: "مؤشرات لكل قسم، أهداف بفعليٍّ محسوب، ومراجعات ذاتي ← مدير ← HR", icon: "🎯" },
    { href: "/dashboard/hr/expenses", title: "مصروفات الموظفين", desc: "المطالبات المعتمدة ودفعها بقيدها", icon: "🧾" },
    { href: "/dashboard/hr/offboarding", title: "إنهاء الخدمة", desc: "الطلبات، إخلاء الطرف، التسوية النهائية", icon: "🚪" },
    { href: "/dashboard/hr/costs", title: "كلفة الموارد البشرية", desc: "الكلفة حسب القسم والمشروع، وربط الحسابات المحاسبية", icon: "📊" },
    { href: "/dashboard/hr/settings", title: "إعدادات HR", desc: "سياسات الإجازات، سلاسل الموافقة، الورديات، العمل الإضافي", icon: "⚙️" },
    ...((await isAdmin())
      ? [{ href: "/dashboard/settings/roles", title: "الأدوار والصلاحيات", desc: "أدوار قابلة للإدارة ومصفوفة الصلاحيات لكل وحدة", icon: "🔐" }]
      : []),
    { href: "/dashboard/attendance", title: "الدوام", desc: "بصمات اليوم وساعات العمل والتقرير الشهري", icon: "⏱️" },
    { href: "/dashboard/hr/month-close", title: "إغلاق الشهر", desc: "ابنِ كشوف الجميع، راجع الشاذّ، ثم اعتمد دفعة واحدة", icon: "📆" },
    { href: "/dashboard/attendance/rules", title: "قواعد خصم الدوام", desc: "معاملات الغياب والتأخير، ومعاينة ما سيُخصم قبل أن يُخصم", icon: "⚖️" },
    { href: "/dashboard/hr/leaves", title: "الإجازات", desc: "طلبات الإجازات والموافقات", icon: "🏖️" },
    { href: "/dashboard/hr/payroll", title: "كشوف الرواتب", desc: "توليد ومتابعة الرواتب", icon: "💵" },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">HR</h1>
      </header>

      <HrTabs active="admin" manager={true} />

      <section className="p-6">
        <HrDashboardPanel data={dash} error={dashError} />

        <h3 className="mt-8 text-lg font-semibold text-gray-700">الأقسام</h3>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="rounded-2xl border bg-white p-6 shadow-sm transition hover:border-brand-500 hover:shadow-md"
            >
              <div className="text-3xl">{s.icon}</div>
              <h4 className="mt-3 text-lg font-semibold text-gray-800">{s.title}</h4>
              <p className="mt-1 text-sm text-gray-500">{s.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
