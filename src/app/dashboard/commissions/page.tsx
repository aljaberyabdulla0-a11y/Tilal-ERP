import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getProjects, getTeamMembers } from "@/lib/projects";
import {
  CommissionTier,
  EmployeeCommissionRule,
  ProjectCommission,
  SaleCommission,
} from "@/lib/types";
import CommissionsTabs from "./commissions-tabs";

// ============================================================
// العمولات — بابٌ مستقلّ.
//
// كانت نسبةً واحدة في الإعدادات تسري على كل شيء. والواقع أن لكل
// مشروع نسبته وتاركته، ولكل موظف قاعدته. فصار لها بابها.
// ============================================================
export default async function CommissionsPage() {
  // للمدير وحده — وسياسات القاعدة تفرض ذلك أيضاً، فلا يكفي
  // إخفاء البند من القائمة (sql/049).
  const admin = await isAdmin();
  if (!admin) redirect("/dashboard");

  const supabase = await createClient();
  const [projects, employees, { data: rates }, { data: tiers }, { data: rules }, { data: earned }] =
    await Promise.all([
      getProjects(),
      getTeamMembers(),
      supabase.from("project_commissions").select("*"),
      supabase.from("commission_tiers").select("*").order("min_sales"),
      supabase
        .from("employee_commission_rules")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("sale_commissions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← لوحة التحكم
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">العمولات</h1>
            <p className="text-sm text-gray-500">
              نسبة الشركة من كل مشروع، وقواعد نصيب الموظفين منها.
            </p>
          </div>
        </div>
        {!admin && (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
            للاطّلاع فقط
          </span>
        )}
      </header>

      <section className="p-6">
        <CommissionsTabs
          isAdmin={admin}
          projects={projects}
          employees={employees}
          rates={(rates ?? []) as ProjectCommission[]}
          tiers={(tiers ?? []) as CommissionTier[]}
          rules={(rules ?? []) as EmployeeCommissionRule[]}
          earned={(earned ?? []) as SaleCommission[]}
        />
      </section>
    </main>
  );
}
