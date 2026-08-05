import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/hr";
import {
  Attendance,
  CompanySettings,
  WorkLocation,
  formatPrice,
} from "@/lib/types";
import { baghdadDate } from "@/lib/time";
import CheckInOut from "./me/check-in-out";

// لوحة تحكم الموظف — بياناته الشخصية فقط (لا أرقام عامة للشركة)
export default async function EmployeeDashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const emp = await getMyEmployee();
  const uid = user?.id ?? "";
  // يوم البصمة بتوقيت بغداد (خادم Vercel يعمل بـ UTC فلا نعتمد عليه)
  const today = baghdadDate();

  // إعدادات ومواقع البصمة
  const [{ data: cfg }, { data: locs }] = await Promise.all([
    supabase.from("company_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("work_locations").select("*").eq("is_active", true),
  ]);
  const settings = (cfg as CompanySettings) ?? null;
  const locations = (locs ?? []) as WorkLocation[];

  // عملائي وحجوزاتي (ما أضفته أنا)
  const [clientsRes, resRes] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("created_by", uid),
    supabase.from("reservations").select("*", { count: "exact", head: true }).eq("created_by", uid),
  ]);
  const myClients = clientsRes.count ?? 0;
  const myReservations = resRes.count ?? 0;

  // بيانات ترتبط بملف الموظف (حضور اليوم + العمولات)
  let todayAtt: Attendance | null = null;
  let commissionsTotal = 0;
  if (emp) {
    const [attRes, commRes] = await Promise.all([
      supabase.from("attendance").select("*").eq("employee_id", emp.id).eq("work_date", today).maybeSingle(),
      supabase.from("commissions").select("amount").eq("employee_id", emp.id),
    ]);
    todayAtt = (attRes.data as Attendance) ?? null;
    commissionsTotal = (commRes.data ?? []).reduce(
      (s: number, c: { amount: number }) => s + c.amount,
      0
    );
  }

  // آخر عملائي
  const { data: recentData } = await supabase
    .from("clients")
    .select("id, name, governorate, created_at")
    .eq("created_by", uid)
    .order("created_at", { ascending: false })
    .limit(5);
  const recentClients = (recentData ?? []) as {
    id: string;
    name: string;
    governorate: string | null;
    created_at: string;
  }[];

  const greeting = new Date().getHours() < 12 ? "صباح الخير" : "مساء الخير";

  const kpis = [
    { icon: "groups", label: "عملائي", value: String(myClients), iconColor: "text-brand-700 bg-brand-50" },
    { icon: "key", label: "حجوزاتي", value: String(myReservations), iconColor: "text-blue-700 bg-blue-50" },
    { icon: "paid", label: "إجمالي عمولاتي", value: formatPrice(commissionsTotal), iconColor: "text-emerald-700 bg-emerald-50" },
  ];

  return (
    <main className="p-6 lg:p-8">
      {/* التحية */}
      <section className="mb-6">
        <h1 className="text-3xl font-bold text-brand-900">
          {greeting}{emp ? `، ${emp.full_name}` : ""} 👋
        </h1>
        <p className="mt-1 text-gray-500">هذه لوحتك الشخصية — متابعة عملك وحضورك.</p>
      </section>

      {/* البصمة — المعفيّون (الإدارة) لا يظهر لهم */}
      {emp && emp.exempt_from_attendance ? (
        <section className="mb-6">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-slate-700">
            حسابك <b>معفى من البصمة</b> — لا يُحتسب عليك غياب ولا تأخير.
          </div>
        </section>
      ) : emp ? (
        <section className="mb-6">
          <CheckInOut
            employeeId={emp.id}
            todayRecord={todayAtt}
            settings={settings}
            locations={locations}
          />
        </section>
      ) : (
        <section className="mb-6">
          <div className="rounded-2xl bg-amber-50 p-5 text-amber-800">
            لم يتم ربط حسابك بملف موظف بعد — راجع المدير لتفعيل تسجيل الحضور ورؤية راتبك.
          </div>
        </section>
      )}

      {/* مؤشراتي */}
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className="glass-card p-5">
            <span className={`material-symbols-outlined rounded-lg p-2 ${k.iconColor}`}>
              {k.icon}
            </span>
            <p className="mt-3 text-xs font-bold uppercase text-gray-400">{k.label}</p>
            <h3 className="mt-1 text-2xl font-bold text-brand-900" dir="ltr">{k.value}</h3>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* آخر عملائي */}
        <div className="glass-card p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-lg font-bold text-brand-900">آخر عملائي</h4>
            <Link href="/dashboard/clients" className="text-sm font-bold text-brand-700 hover:underline">
              عرض الكل
            </Link>
          </div>
          {recentClients.length === 0 ? (
            <p className="text-sm text-gray-400">لم تُضف أي عميل بعد.</p>
          ) : (
            <table className="w-full text-right text-sm">
              <tbody>
                {recentClients.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2.5">
                      <Link href={`/dashboard/clients/${c.id}`} className="font-medium text-brand-700 hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-2.5 text-gray-500">{c.governorate || "—"}</td>
                    <td className="py-2.5 text-left text-xs text-gray-400" dir="ltr">
                      {new Date(c.created_at).toLocaleDateString("ar")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* روابط سريعة */}
        <div className="glass-card p-6">
          <h4 className="mb-4 text-lg font-bold text-brand-900">أدواتي</h4>
          <div className="space-y-2">
            {[
              { href: "/dashboard/clients/new", label: "إضافة عميل جديد", icon: "person_add" },
              { href: "/dashboard/reservations/new", label: "تسجيل حجز جديد", icon: "key" },
              { href: "/dashboard/me/leaves", label: "إجازاتي", icon: "beach_access" },
              { href: "/dashboard/me/salary", label: "راتبي وعمولاتي", icon: "payments" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex items-center gap-3 rounded-xl bg-gray-50 p-3 text-gray-700 transition hover:bg-brand-50 hover:text-brand-700"
              >
                <span className="material-symbols-outlined text-brand-600">{l.icon}</span>
                <span className="font-medium">{l.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
