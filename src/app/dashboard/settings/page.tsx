import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import RoleSelect from "./role-select";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("profiles")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: true });

  const profiles = (data ?? []) as Profile[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">الإعدادات — المستخدمون والصلاحيات</h1>
      </header>

      <section className="p-6">
        <p className="mb-4 text-sm text-gray-500">
          هنا تتحكّم بأدوار المستخدمين. <b>المدير</b> يقدر يضيف ويعدّل ويحذف،
          و<b>الموظف</b> يقدر يضيف ويشاهد فقط.
        </p>

        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="w-full min-w-[600px] text-right text-sm">
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
                        p.role === "admin"
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {p.role === "admin" ? "مدير" : "موظف"}
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
