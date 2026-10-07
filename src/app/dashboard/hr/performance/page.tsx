import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageHr } from "@/lib/auth";
import { getMyManagedDepartmentIds } from "@/lib/org";
import { TargetsBoard, ReviewsBoard } from "./performance-boards";

// الأداء والأهداف (sql/160): HR الكل، والمدير فريقه وقسمه — RLS تحدّد
// ما يُرى. الفعلي والإنجاز والنتيجة النهائية من القاعدة.
export default async function PerformancePage({ searchParams }: { searchParams: { month?: string } }) {
  const supabase = await createClient();
  const [hr, managed, { data: teamIds }] = await Promise.all([
    canManageHr(),
    getMyManagedDepartmentIds(),
    supabase.rpc("my_team_employee_ids"),
  ]);
  const team = ((teamIds ?? []) as { id: string }[]).map((t) => t.id);
  if (!hr && managed.length === 0 && team.length === 0) redirect("/dashboard/me/performance");

  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? searchParams.month! : new Date().toISOString().slice(0, 7);
  const start = `${month}-01`;

  const [{ data: targets }, { data: kpis }, { data: reviews }, { data: emps }, { data: deps }, { data: settings }] =
    await Promise.all([
      supabase.from("employee_targets").select("*").eq("period_start", start).not("kpi_code", "is", null).order("created_at"),
      supabase.from("kpi_definitions").select("*").eq("active", true).order("sort_order"),
      supabase.from("performance_reviews").select("*").order("period_start", { ascending: false }).limit(200),
      // HR يرى الجميع؛ والمدير فريقه بأسمائهم من my_team (بلا رواتب)
      hr
        ? supabase.from("employees").select("id, full_name").eq("status", "active").order("full_name")
        : supabase.rpc("team_member_names"),
      supabase.from("departments").select("id, name_ar").eq("status", "نشط").order("sort_order"),
      supabase.from("performance_settings").select("*").eq("id", 1).maybeSingle(),
    ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href={hr ? "/dashboard/hr" : "/dashboard/me"} className="text-sm text-gray-500 hover:text-brand-700">
            ← {hr ? "الموارد البشرية" : "بوابتي"}
          </Link>
          <h1 className="text-xl font-bold text-brand-700">الأداء والأهداف</h1>
        </div>
        <form className="flex items-center gap-2 text-sm">
          <input type="month" name="month" defaultValue={month} dir="ltr" className="rounded border px-2 py-1" />
          <button className="rounded bg-brand-600 px-3 py-1 text-white">عرض</button>
        </form>
      </header>
      <section className="space-y-6 p-6">
        <TargetsBoard
          month={month}
          targets={targets ?? []}
          kpis={kpis ?? []}
          employees={(emps ?? []) as { id: string; full_name: string }[]}
          departments={(deps ?? []) as { id: string; name_ar: string }[]}
          isHr={hr}
        />
        <ReviewsBoard
          reviews={reviews ?? []}
          employees={(emps ?? []) as { id: string; full_name: string }[]}
          departments={(deps ?? []) as { id: string; name_ar: string }[]}
          settings={settings}
          isHr={hr}
        />
      </section>
    </main>
  );
}
