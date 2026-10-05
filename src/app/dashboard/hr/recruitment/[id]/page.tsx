import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import {
  CANDIDATE_COLUMNS,
  Candidate,
  JobApplication,
  JobInterview,
  JobOffer,
  JobOpening,
} from "@/lib/recruitment";
import Pipeline from "./pipeline";
import OpeningSettings from "./opening-settings";

// الوظيفة ومسار مرشحيها (sql/150). RLS تحدّد ما يُرى: HR كل شيء،
// ومدير القسم مرشحيه بلا رواتب العروض، والمقيِّم مقابلاته.
export default async function OpeningPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: op } = await supabase.from("job_openings").select("*").eq("id", params.id).maybeSingle();
  if (!op) notFound();
  const opening = op as JobOpening;

  const [{ data: canManage }, admin, user, { data: apps }, { data: dep }, { data: emps }] = await Promise.all([
    supabase.rpc("can_manage_recruitment"),
    isAdmin(),
    getCurrentUser(),
    supabase.from("job_applications").select("*").eq("opening_id", opening.id).order("created_at"),
    supabase.from("departments").select("name_ar").eq("id", opening.department_id).maybeSingle(),
    supabase.from("employees").select("id, full_name, employee_code").eq("status", "active").order("full_name"),
  ]);

  const applications = (apps ?? []) as JobApplication[];
  const appIds = applications.length ? applications.map((a) => a.id) : ["00000000-0000-0000-0000-000000000000"];
  const candIds = applications.length ? applications.map((a) => a.candidate_id) : ["00000000-0000-0000-0000-000000000000"];

  const [{ data: cands }, { data: ivs }, { data: offs }] = await Promise.all([
    supabase.from("candidates").select(CANDIDATE_COLUMNS).in("id", candIds),
    supabase.from("job_interviews").select("*").in("application_id", appIds).order("scheduled_at"),
    supabase.from("job_offers").select("*").in("application_id", appIds).order("created_at"),
  ]);

  // الراتب المتوقّع خارج أعمدة المرشح — تُرجعه الدالة لـ HR والمالية وحدهما
  const expected: Record<string, number | null> = {};
  if (canManage === true) {
    await Promise.all(
      applications.map(async (a) => {
        const { data } = await supabase.rpc("candidate_expected_salary", { p_candidate: a.candidate_id });
        expected[a.candidate_id] = (data as number | null) ?? null;
      })
    );
  }

  const people = (emps ?? []) as { id: string; full_name: string; employee_code: string }[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/hr/recruitment" className="text-sm text-gray-500 hover:text-brand-700">← التوظيف</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-brand-700">{opening.title}</h1>
          <span className="font-mono text-xs text-gray-400" dir="ltr">{opening.opening_no}</span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{(dep as { name_ar: string } | null)?.name_ar}</span>
          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{opening.status}</span>
          <span className="text-xs text-gray-500">المطلوب: {opening.headcount}</span>
        </div>
      </header>

      <section className="space-y-6 p-6">
        {canManage === true && <OpeningSettings opening={opening} people={people} />}

        <Pipeline
          opening={opening}
          applications={applications}
          candidates={(cands ?? []) as unknown as Candidate[]}
          interviews={(ivs ?? []) as JobInterview[]}
          offers={(offs ?? []) as JobOffer[]}
          expected={expected}
          people={people}
          canManage={canManage === true}
          isAdmin={admin}
          myUserId={user?.id ?? ""}
        />
      </section>
    </main>
  );
}
