import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isBroker } from "@/lib/auth";
import { Branch, Department, canManageOrg, getDepartmentTree, getMyManagedDepartmentIds } from "@/lib/org";
import OrgManager from "./org-manager";

// الهيكل التنظيمي (sql/145): الشجرة يقرؤها كل موظف داخلي، ويديرها
// المدير وHR (أو من له صلاحية «إدارة الهيكل» في المصفوفة).
export default async function OrganizationPage({
  searchParams,
}: {
  searchParams: { archived?: string };
}) {
  if (await isBroker()) redirect("/dashboard");

  const showArchived = searchParams.archived === "1";
  const supabase = await createClient();
  const [tree, manage, managed, { data: deps }, { data: brs }, { data: emps }] = await Promise.all([
    getDepartmentTree(showArchived),
    canManageOrg(),
    getMyManagedDepartmentIds(),
    supabase.from("departments").select("*").order("sort_order"),
    supabase.from("branches").select("id, code, name_ar, status").order("code"),
    // RLS: HR والمدير يرون الجميع، وغيرهم نفسه — فالقائمة لمن يدير فقط
    supabase.from("employees").select("id, full_name, employee_code").eq("status", "active").order("full_name"),
  ]);

  if (tree.length === 0 && !manage) redirect("/dashboard/me");

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href={manage ? "/dashboard/hr" : "/dashboard/me"} className="text-sm text-gray-500 hover:text-brand-700">
            ← {manage ? "الموارد البشرية" : "بوابتي"}
          </Link>
          <h1 className="text-xl font-bold text-brand-700">الهيكل التنظيمي</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/dashboard/hr/positions" className="text-brand-700 hover:underline">
            المناصب والدرجات ←
          </Link>
          <Link
            href={showArchived ? "/dashboard/hr/organization" : "/dashboard/hr/organization?archived=1"}
            className="rounded-lg border px-3 py-1.5 text-gray-600 hover:bg-gray-50"
          >
            {showArchived ? "إخفاء المؤرشف" : "إظهار المؤرشف"}
          </Link>
        </div>
      </header>

      <section className="p-6">
        <OrgManager
          tree={tree}
          departments={(deps ?? []) as Department[]}
          branches={(brs ?? []) as Branch[]}
          people={(emps ?? []) as { id: string; full_name: string; employee_code: string }[]}
          canManage={manage}
          viewable={managed}
        />
      </section>
    </main>
  );
}
