import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/auth";
import { Department, EmploymentType, JobGrade, Position, Role, canManageOrg } from "@/lib/org";
import PositionsManager from "./positions-manager";

// المناصب والدرجات الوظيفية (sql/145). يديرها من يدير الهيكل، والمالية
// تقرأ الدرجات (نطاق الرواتب). نطاق الراتب يسكن الدرجة لا المنصب.
export default async function PositionsPage() {
  const [manage, finance] = await Promise.all([canManageOrg(), canManageFinance()]);
  if (!manage && !finance) redirect("/dashboard/hr/organization");

  const supabase = await createClient();
  const [{ data: poss }, { data: deps }, { data: grades }, { data: types }, { data: roles }, { data: emps }] =
    await Promise.all([
      supabase.from("positions").select("*").order("sort_order"),
      supabase.from("departments").select("*").order("sort_order"),
      supabase.from("job_grades").select("*").order("level"),
      supabase.from("employment_types").select("*").order("sort_order"),
      supabase.from("roles").select("*").eq("status", "نشط").order("sort_order"),
      supabase.from("employees").select("position_id").eq("status", "active"),
    ]);

  const holders: Record<string, number> = {};
  ((emps ?? []) as { position_id: string | null }[]).forEach((e) => {
    if (e.position_id) holders[e.position_id] = (holders[e.position_id] ?? 0) + 1;
  });

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/hr/organization" className="text-sm text-gray-500 hover:text-brand-700">
          ← الهيكل التنظيمي
        </Link>
        <h1 className="text-xl font-bold text-brand-700">المناصب والدرجات</h1>
      </header>
      <section className="p-6">
        <PositionsManager
          positions={(poss ?? []) as Position[]}
          departments={(deps ?? []) as Department[]}
          grades={(grades ?? []) as JobGrade[]}
          employmentTypes={(types ?? []) as EmploymentType[]}
          roles={(roles ?? []) as Role[]}
          holders={holders}
          canManage={manage}
        />
      </section>
    </main>
  );
}
