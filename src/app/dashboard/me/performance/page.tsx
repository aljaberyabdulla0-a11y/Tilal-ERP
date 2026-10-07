import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/hr";
import SelfReview from "./self-review";

type Target = { id: string; title: string; period_start: string; target_value: number | null; actual_value: number | null; achievement_pct: number | null };
type Review = { id: string; cycle: string; period_start: string; period_end: string; status: string;
  self_score: number | null; manager_score: number | null; manager_comments: string | null;
  hr_score: number | null; hr_comments: string | null; final_score: number | null; recommendation: string | null; targets_pct: number | null };

// أدائي (sql/160): أهدافي وإنجازها، ومراجعاتي وتقييمي الذاتي
export default async function MyPerformancePage() {
  const emp = await getMyEmployee();
  if (!emp) redirect("/dashboard/me");
  const supabase = await createClient();
  const [{ data: t }, { data: r }] = await Promise.all([
    supabase.from("employee_targets").select("*").eq("employee_id", emp.id).not("kpi_code", "is", null)
      .order("period_start", { ascending: false }).limit(60),
    supabase.from("performance_reviews").select("*").eq("employee_id", emp.id).order("period_start", { ascending: false }),
  ]);
  const targets = (t ?? []) as Target[];
  const reviews = (r ?? []) as Review[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/me" className="text-sm text-gray-500 hover:text-brand-700">← بوابتي</Link>
        <h1 className="text-xl font-bold text-brand-700">أدائي</h1>
      </header>
      <section className="space-y-6 p-6">
        {reviews.filter((x) => x.status === "تقييم ذاتي").map((x) => (
          <SelfReview key={x.id} reviewId={x.id} label={`${x.cycle} · ${x.period_start} → ${x.period_end}`} />
        ))}

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h3 className="mb-3 text-lg font-semibold text-gray-800">أهدافي</h3>
          {targets.length === 0 ? (
            <p className="text-sm text-gray-400">لا أهداف محدّدة بعد.</p>
          ) : (
            <ul className="space-y-3">
              {targets.map((x) => (
                <li key={x.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-gray-800">{x.title}</span>
                    <span className="text-xs text-gray-500" dir="ltr">{x.period_start.slice(0, 7)} · {x.actual_value ?? "—"} / {x.target_value ?? "—"}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className={`h-full ${(x.achievement_pct ?? 0) >= 100 ? "bg-green-500" : "bg-brand-500"}`}
                      style={{ width: `${Math.min(x.achievement_pct ?? 0, 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h3 className="mb-3 text-lg font-semibold text-gray-800">مراجعاتي</h3>
          {reviews.length === 0 ? (
            <p className="text-sm text-gray-400">لا مراجعات.</p>
          ) : (
            <ul className="divide-y">
              {reviews.map((x) => (
                <li key={x.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{x.cycle} <span className="text-xs text-gray-400" dir="ltr">{x.period_start} → {x.period_end}</span></span>
                    <span className="text-xs text-gray-500">{x.status}</span>
                  </div>
                  {x.status === "مكتمل" && (
                    <div className="mt-1 text-xs text-gray-600">
                      النتيجة <b>{x.final_score}</b> من 100 · الأهداف {x.targets_pct ?? "—"}% · ذاتي {x.self_score} · المدير {x.manager_score ?? "—"} · HR {x.hr_score}
                      {x.recommendation && x.recommendation !== "لا شيء" && ` · التوصية: ${x.recommendation}`}
                      {x.manager_comments && <p className="mt-1 text-gray-500">المدير: {x.manager_comments}</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
