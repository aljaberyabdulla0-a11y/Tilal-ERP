import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageHr } from "@/lib/auth";
import { ProbationRow } from "@/lib/recruitment";
import ProbationActions from "./probation-actions";

// فترة التجربة (sql/151): من تحت التجربة في نطاقي — HR الكل، والمدير
// فريقه. التقييم من المدير ثم HR، والقرار لـ HR.
export default async function ProbationPage() {
  const supabase = await createClient();
  const [hr, { data, error }] = await Promise.all([canManageHr(), supabase.rpc("probation_overview")]);
  const rows = (data ?? []) as ProbationRow[];
  if (!hr && rows.length === 0 && !error) redirect("/dashboard/me");

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href={hr ? "/dashboard/hr" : "/dashboard/me"} className="text-sm text-gray-500 hover:text-brand-700">
          ← {hr ? "الموارد البشرية" : "بوابتي"}
        </Link>
        <h1 className="text-xl font-bold text-brand-700">فترة التجربة</h1>
      </header>

      <section className="space-y-4 p-6">
        {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
        {rows.length === 0 && (
          <p className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-gray-400">لا أحد تحت التجربة.</p>
        )}
        {rows.map((r) => (
          <div key={r.employee_id} className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                {hr ? (
                  <Link href={`/dashboard/hr/employees/${r.employee_id}`} className="font-semibold text-brand-700 hover:underline">
                    {r.full_name}
                  </Link>
                ) : (
                  <span className="font-semibold text-gray-800">{r.full_name}</span>
                )}
                <span className="ms-2 font-mono text-[10px] text-gray-400" dir="ltr">{r.employee_code}</span>
                <p className="text-xs text-gray-500">
                  {[r.position_title, r.department_name].filter(Boolean).join(" — ")}
                  {r.manager_name ? ` · المدير: ${r.manager_name}` : ""}
                </p>
                {r.last_decision && <p className="mt-1 text-xs text-gray-500">آخر قرار: {r.last_decision}</p>}
              </div>
              <div className="text-end">
                <p className="text-xs text-gray-500" dir="ltr">{r.probation_start ?? "—"} → {r.probation_end}</p>
                <p className={`text-sm font-semibold ${r.days_left < 0 ? "text-red-600" : r.days_left <= 14 ? "text-amber-600" : "text-gray-700"}`}>
                  {r.days_left < 0 ? `انتهت منذ ${-r.days_left} يوماً` : `باقٍ ${r.days_left} يوماً`}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div className={`rounded-lg p-2 ${r.manager_review ? "bg-green-50" : "bg-gray-50"}`}>
                تقييم المدير: {r.manager_review ? <b>{r.manager_score}/5 — {r.manager_recommendation}</b> : <span className="text-gray-400">لم يُقدَّم</span>}
              </div>
              <div className={`rounded-lg p-2 ${r.hr_review ? "bg-green-50" : "bg-gray-50"}`}>
                تقييم HR: {r.hr_review ? <b>{r.hr_score}/5 — {r.hr_recommendation}</b> : <span className="text-gray-400">لم يُقدَّم</span>}
              </div>
            </div>
            <ProbationActions row={r} isHr={hr} />
          </div>
        ))}
      </section>
    </main>
  );
}
