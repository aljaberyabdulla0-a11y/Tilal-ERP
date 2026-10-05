import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance, canSeePayroll } from "@/lib/auth";
import { formatPrice } from "@/lib/types";
import AccountMap from "./account-map";

type DeptCost = {
  department_id: string | null; department_name: string; employees: number; basic: number; allowances: number;
  overtime: number; bonuses: number; commissions: number; deductions: number; total_cost: number;
};
type ProjCost = { project_id: string | null; project_name: string; employees: number; cost: number };

// كلفة الموارد البشرية (sql/158): لكل قسم من بنود الكشوف، ولكل مشروع
// بنِسَب توزيع الموظفين. المجاميع من القاعدة — الصفحة تعرض فقط.
export default async function HrCostsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const [see, finance] = await Promise.all([canSeePayroll(), canManageFinance()]);
  if (!see && !finance) redirect("/dashboard");

  const year = new Date().getFullYear();
  const from = /^\d{4}-\d{2}$/.test(searchParams.from ?? "") ? searchParams.from! : `${year}-01`;
  const to = /^\d{4}-\d{2}$/.test(searchParams.to ?? "") ? searchParams.to! : `${year}-12`;

  const supabase = await createClient();
  const [{ data: depts, error }, { data: projs }, { data: map }, { data: accounts }] = await Promise.all([
    supabase.rpc("department_costs", { p_from: from, p_to: to }),
    supabase.rpc("project_payroll_costs", { p_from: from, p_to: to }),
    supabase.from("hr_account_map").select("*").order("key"),
    finance ? supabase.from("accounts").select("code, name").order("code") : Promise.resolve({ data: [] }),
  ]);
  const rows = (depts ?? []) as DeptCost[];
  const projects = (projs ?? []) as ProjCost[];

  const th = "px-3 py-2 text-start font-medium";
  const td = "px-3 py-2";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/hr" className="text-sm text-gray-500 hover:text-brand-700">← الموارد البشرية</Link>
          <h1 className="text-xl font-bold text-brand-700">كلفة الموارد البشرية</h1>
        </div>
        <form className="flex items-center gap-2 text-sm">
          <input type="month" name="from" defaultValue={from} dir="ltr" className="rounded border px-2 py-1" />
          <span>→</span>
          <input type="month" name="to" defaultValue={to} dir="ltr" className="rounded border px-2 py-1" />
          <button className="rounded bg-brand-600 px-3 py-1 text-white">عرض</button>
        </form>
      </header>

      <section className="space-y-6 p-6">
        {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}

        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-3 font-semibold text-gray-800">حسب القسم</div>
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className={th}>القسم</th><th className={th}>موظفون</th><th className={th}>الأساسي</th>
                <th className={th}>البدلات</th><th className={th}>الإضافي</th><th className={th}>المكافآت</th>
                <th className={th}>العمولات</th><th className={th}>الكلفة</th><th className={th}>الاستقطاعات</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} className="p-5 text-center text-gray-400">لا كشوف في الفترة.</td></tr>}
              {rows.map((r) => (
                <tr key={r.department_id ?? "none"} className="border-b last:border-0">
                  <td className={`${td} font-medium`}>{r.department_name}</td>
                  <td className={td}>{r.employees}</td>
                  {[r.basic, r.allowances, r.overtime, r.bonuses, r.commissions].map((v, i) => (
                    <td key={i} className={td} dir="ltr">{formatPrice(v)}</td>
                  ))}
                  <td className={`${td} font-bold`} dir="ltr">{formatPrice(r.total_cost)}</td>
                  <td className={`${td} text-red-700`} dir="ltr">{formatPrice(r.deductions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-3 font-semibold text-gray-800">
            حسب المشروع <span className="text-xs font-normal text-gray-500">— بنِسَب توزيع الموظفين، والباقي لمشروع الكشف أو «عام»</span>
          </div>
          <table className="w-full min-w-[500px] text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr><th className={th}>المشروع</th><th className={th}>موظفون</th><th className={th}>الكلفة</th></tr>
            </thead>
            <tbody>
              {projects.length === 0 && <tr><td colSpan={3} className="p-5 text-center text-gray-400">لا كشوف في الفترة.</td></tr>}
              {projects.map((p) => (
                <tr key={p.project_id ?? "general"} className="border-b last:border-0">
                  <td className={`${td} font-medium`}>{p.project_name}</td>
                  <td className={td}>{p.employees}</td>
                  <td className={`${td} font-bold`} dir="ltr">{formatPrice(p.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <AccountMap
          map={(map ?? []) as { key: string; label: string; account_code: string }[]}
          accounts={(accounts ?? []) as { code: string; name: string }[]}
          canEdit={finance}
        />
      </section>
    </main>
  );
}
