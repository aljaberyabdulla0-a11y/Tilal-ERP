import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Employee, formatPrice } from "@/lib/types";

// قائمة الموظفين (للمدير)
export default async function EmployeesPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .order("created_at", { ascending: false });

  const employees = (data ?? []) as Employee[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/hr" className="text-sm text-gray-500 hover:text-brand-700">
            ← الموارد البشرية
          </Link>
          <h1 className="text-xl font-bold text-brand-700">الموظفون</h1>
        </div>
        <Link
          href="/dashboard/hr/employees/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + موظف جديد
        </Link>
      </header>

      <section className="p-6">
        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            تعذّر جلب الموظفين: {error.message}
            <br />
            تأكّد من تشغيل ملف SQL للموارد البشرية.
          </div>
        )}

        {!error && employees.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا يوجد موظفون بعد — أضف أول موظف.
          </div>
        )}

        {!error && employees.length > 0 && (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[700px] text-right text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الاسم</th>
                  <th className="px-4 py-3 font-medium">المسمّى الوظيفي</th>
                  <th className="px-4 py-3 font-medium">القسم</th>
                  <th className="px-4 py-3 font-medium">الراتب الأساسي</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">الحساب</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/dashboard/hr/employees/${e.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {e.full_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{e.job_title || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{e.department || "—"}</td>
                    <td className="px-4 py-3 text-gray-800" dir="ltr">
                      {formatPrice(e.base_salary)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          e.status === "active"
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-200 text-gray-600"
                        }`}
                      >
                        {e.status === "active" ? "على رأس العمل" : "غير نشط"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {e.user_id ? (
                        <span className="text-xs text-green-600">مرتبط</span>
                      ) : (
                        <span className="text-xs text-gray-400">غير مرتبط</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
