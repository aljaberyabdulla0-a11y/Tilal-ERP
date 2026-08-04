import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import HrTabs from "./hr-tabs";

// الصفحة الرئيسية للموارد البشرية (للمدير) — غير المدير يُحوّل لبوابة الموظف
export default async function HrHome() {
  if (!(await isAdmin())) redirect("/dashboard/me");

  const supabase = await createClient();
  const [{ count: empCount }, { count: pendingLeaves }] = await Promise.all([
    supabase.from("employees").select("*", { count: "exact", head: true }),
    supabase
      .from("leaves")
      .select("*", { count: "exact", head: true })
      .eq("status", "معلقة"),
  ]);

  const sections = [
    { href: "/dashboard/hr/employees", title: "الموظفون", desc: "بيانات الموظفين والرواتب", icon: "🧑‍💼" },
    { href: "/dashboard/hr/attendance", title: "سجل الحضور", desc: "بصمات اليوم ومواقعها وتسجيل يدوي", icon: "👆" },
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

      <HrTabs active="admin" isAdmin={true} />

      <section className="p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <span className="text-sm text-gray-500">عدد الموظفين</span>
            <p className="mt-2 text-3xl font-bold text-gray-800">{empCount ?? 0}</p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <span className="text-sm text-gray-500">طلبات إجازة معلّقة</span>
            <p className="mt-2 text-3xl font-bold text-amber-600">{pendingLeaves ?? 0}</p>
          </div>
        </div>

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
