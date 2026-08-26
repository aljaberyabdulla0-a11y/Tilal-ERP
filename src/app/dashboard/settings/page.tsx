import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { CompanySettings, ROLE_COLORS, ROLE_LABELS, WorkLocation } from "@/lib/types";
import RoleSelect from "./role-select";
import WorkLocations from "./work-locations";
import WorkHours from "./work-hours";

type Profile = {
  id: string;
  email: string | null;
  role: string;
  created_at: string;
};

// صفحة الإعدادات — إدارة المستخدمين وأدوارهم (للمدير فقط)
export default async function SettingsPage() {
  // حماية: غير المدير يُعاد للوحة التحكم
  if (!(await isAdmin())) {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const user = await getCurrentUser();

  const [{ data }, { data: cfg }, { data: locs }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, role, created_at")
      .order("created_at", { ascending: true }),
    supabase.from("company_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("work_locations").select("*").order("created_at"),
  ]);

  const profiles = (data ?? []) as Profile[];
  const settings = (cfg as CompanySettings) ?? null;
  const locations = (locs ?? []) as WorkLocation[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">الإعدادات</h1>
      </header>

      <section className="space-y-8 p-6">
        {/* أوقات الدوام */}
        <WorkHours settings={settings} />

        {/* مواقع العمل والبصمة */}
        <WorkLocations locations={locations} settings={settings} />

        <h2 className="text-lg font-bold text-gray-800">المستخدمون والصلاحيات</h2>
        <p className="-mt-4 mb-4 text-sm text-gray-500">
          هنا تتحكّم بأدوار المستخدمين. <b>المدير</b> يرى كل شيء ويعدّل ويحذف.
          و<b>المشرف</b> موظف نطاقه مشروعه: يرى ليدات فريقه ومتابعاتهم وحضورهم
          ويوافق على إجازاتهم — بلا محاسبة ولا رواتب. و<b>مدير المتابعة</b> مسؤول
          عن التشغيل اليومي: المخزون كاملاً (شراء وصرف وموردون وتقارير)، ومتابعة
          الموظفين والاتصالات والمهام <b>قراءةً</b> — بلا محاسبة ولا فواتير ولا
          رواتب ولا موافقة على إجازة. و<b>الموظف</b> يرى عملاءه هو فقط. إسناد
          الموظفين للمشاريع من{" "}
          <Link href="/dashboard/projects" className="font-semibold underline">
            صفحة المشاريع
          </Link>
          .
        </p>

        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="w-full min-w-[600px] text-start text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">البريد الإلكتروني</th>
                <th className="px-4 py-3 font-medium">الدور الحالي</th>
                <th className="px-4 py-3 font-medium">تغيير الدور</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800" dir="ltr">
                    {p.email || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        ROLE_COLORS[p.role] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {ROLE_LABELS[p.role] ?? p.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <RoleSelect
                      userId={p.id}
                      currentRole={p.role}
                      isSelf={p.id === user?.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-sm text-gray-500">
          الإجمالي: {profiles.length} مستخدم
        </p>
      </section>
    </main>
  );
}
