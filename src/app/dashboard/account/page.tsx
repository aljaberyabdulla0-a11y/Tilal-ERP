import Link from "next/link";
import { getCurrentUser, getUserRole } from "@/lib/auth";
import { getMyEmployee } from "@/lib/hr";
import { getProjects } from "@/lib/projects";
import { ROLE_COLORS, ROLE_LABELS } from "@/lib/types";
import LanguageSwitcher from "@/components/language-switcher";
import ChangePassword from "./change-password";

// ============================================================
// «إعداداتي» — الإعدادات الشخصية، متاحة لكل مستخدم مهما كان دوره.
// لا شيء إداري هنا: لغة الواجهة وكلمة المرور وبياناتي كما هي مسجّلة.
// الإعدادات الإدارية (الأدوار، مواقع العمل، أوقات الدوام) تبقى في
// /dashboard/settings للمدير وحده.
// ============================================================
export default async function AccountPage() {
  const [user, role, employee, projects] = await Promise.all([
    getCurrentUser(),
    getUserRole(),
    getMyEmployee(),
    getProjects(),
  ]);

  const myProject = employee?.project_id
    ? projects.find((p) => p.id === employee.project_id)
    : null;

  const rows: { label: string; value: string }[] = [
    { label: "الاسم", value: employee?.full_name ?? "— غير مربوط بملف موظف —" },
    { label: "المسمّى الوظيفي", value: employee?.job_title || "—" },
    { label: "القسم", value: employee?.department || "—" },
    { label: "الهاتف", value: employee?.phone || "—" },
    { label: "تاريخ التعيين", value: employee?.hire_date || "—" },
    { label: "المشروع", value: myProject?.name ?? "— بلا مشروع —" },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">إعداداتي</h1>
      </header>

      <section className="max-w-3xl space-y-5 p-6">
        {/* الحساب */}
        <div className="glass-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                <span className="material-symbols-outlined">person</span>
              </span>
              <div>
                <p className="font-bold text-gray-800">
                  {employee?.full_name ?? user?.email}
                </p>
                <p className="text-xs text-gray-400" dir="ltr">
                  {user?.email}
                </p>
              </div>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                ROLE_COLORS[role] ?? "bg-gray-100 text-gray-600"
              }`}
            >
              {ROLE_LABELS[role] ?? role}
            </span>
          </div>
        </div>

        {/* لغة الواجهة */}
        <div className="glass-card p-5">
          <h3 className="mb-1 text-lg font-bold text-gray-800">لغة الواجهة</h3>
          <p className="mb-4 text-sm text-gray-500">
            يتغيّر النظام كله فوراً — النصوص واتجاه الصفحة. الاختيار يخصّك وحدك
            ولا يؤثّر على بقية الموظفين.
          </p>
          <LanguageSwitcher />
        </div>

        {/* كلمة المرور */}
        <ChangePassword />

        {/* بياناتي */}
        <div className="glass-card p-5">
          <h3 className="mb-1 text-lg font-bold text-gray-800">بياناتي</h3>
          <p className="mb-4 text-sm text-gray-500">
            هذه بياناتك كما سجّلها المدير. لتعديلها راجعه.
          </p>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-start text-sm">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.label} className={i % 2 ? "bg-gray-50/60" : ""}>
                    <td className="w-40 px-4 py-2.5 text-gray-500">{r.label}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
