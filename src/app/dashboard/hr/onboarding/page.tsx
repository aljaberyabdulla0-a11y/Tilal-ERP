import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { canManageHr } from "@/lib/auth";
import OnboardingTaskButton from "@/components/onboarding-task-button";

type BoardRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  hire_date: string | null;
  title: string;
  owner_role: string;
  assignee_name: string | null;
  due_date: string | null;
  status: string;
  auto_rule: string | null;
  completed_by_name: string | null;
  note: string | null;
  can_complete: boolean;
};

// التهيئة (sql/151): مهام الموظفين الجدد. HR ترى الكل، والمدير مهام
// فريقه وما كُلّف به. ما تتحقّق منه القاعدة يُنجز تلقائياً.
export default async function OnboardingPage({ searchParams }: { searchParams: { all?: string } }) {
  const includeDone = searchParams.all === "1";
  const supabase = await createClient();
  const [hr, { data, error }] = await Promise.all([
    canManageHr(),
    supabase.rpc("onboarding_board", { p_include_done: includeDone }),
  ]);
  const rows = (data ?? []) as BoardRow[];
  const today = new Date().toISOString().slice(0, 10);

  const byEmployee = new Map<string, BoardRow[]>();
  rows.forEach((r) => byEmployee.set(r.employee_id, [...(byEmployee.get(r.employee_id) ?? []), r]));

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href={hr ? "/dashboard/hr" : "/dashboard/me"} className="text-sm text-gray-500 hover:text-brand-700">
            ← {hr ? "الموارد البشرية" : "بوابتي"}
          </Link>
          <h1 className="text-xl font-bold text-brand-700">التهيئة</h1>
        </div>
        <Link href={includeDone ? "/dashboard/hr/onboarding" : "/dashboard/hr/onboarding?all=1"}
          className="rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          {includeDone ? "المعلّقة فقط" : "إظهار المنجزة"}
        </Link>
      </header>

      <section className="space-y-4 p-6">
        {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
        {byEmployee.size === 0 && (
          <p className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-gray-400">
            لا مهام تهيئة معلّقة. تُولَّد تلقائياً لكل موظف جديد.
          </p>
        )}
        {Array.from(byEmployee.entries()).map(([empId, tasks]) => {
          const done = tasks.filter((t) => t.status !== "معلّقة").length;
          return (
            <div key={empId} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  {hr ? (
                    <Link href={`/dashboard/hr/employees/${empId}`} className="font-semibold text-brand-700 hover:underline">
                      {tasks[0].employee_name}
                    </Link>
                  ) : (
                    <span className="font-semibold text-gray-800">{tasks[0].employee_name}</span>
                  )}
                  <span className="ms-2 font-mono text-[10px] text-gray-400" dir="ltr">{tasks[0].employee_code}</span>
                  {tasks[0].hire_date && <span className="ms-2 text-xs text-gray-500">باشر {tasks[0].hire_date}</span>}
                </div>
                {includeDone && <span className="text-xs text-gray-500">{done}/{tasks.length} منجزة</span>}
              </div>
              <ul className="divide-y divide-gray-100">
                {tasks.map((t) => {
                  const late = t.status === "معلّقة" && t.due_date && t.due_date < today;
                  return (
                    <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <span className={t.status === "معلّقة" ? "text-gray-800" : "text-gray-400 line-through"}>{t.title}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{t.owner_role}</span>
                      {t.assignee_name && <span className="text-xs text-gray-500">{t.assignee_name}</span>}
                      {t.due_date && (
                        <span className={`text-xs ${late ? "font-semibold text-red-600" : "text-gray-400"}`} dir="ltr">{t.due_date}</span>
                      )}
                      {t.auto_rule && t.status === "معلّقة" && (
                        <span className="text-[11px] text-blue-600">تُنجز تلقائياً حين تتحقّق</span>
                      )}
                      {t.status !== "معلّقة" && (
                        <span className="text-[11px] text-gray-400">{t.status} — {t.completed_by_name}{t.note ? ` · ${t.note}` : ""}</span>
                      )}
                      {t.can_complete && <OnboardingTaskButton id={t.id} status={t.status} />}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>
    </main>
  );
}
