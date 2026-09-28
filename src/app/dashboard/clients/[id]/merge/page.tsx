import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canWriteCrm } from "@/lib/auth";
import type { Client } from "@/lib/types";
import { getClientMatchCandidates, getOwnerName, getProjectsLite, getStages } from "@/lib/crm";
import ClientMatchList from "@/components/client-match-list";
import MergeWizard, { type MergeSide } from "./merge-wizard";
import MergeSearch from "./merge-search";

// ============================================================
// دمج بطاقتين (sql/104) — /dashboard/clients/[id]/merge?with=<الأخرى>
//
// بلا with: البطاقات المحتملة لهذه البطاقة، وبحثٌ عن غيرها.
// مع with: البطاقتان جنباً إلى جنب، والموظف يختار أيهما تبقى وما
// يبقى من كل حقل مختلف — والفراغ يُملأ بلا سؤال.
//
// الصلاحية تُقرَّر في القاعدة (client_merge_scope): الصفحة تسألها
// لتعرض «ادمج» أو «اطلب الدمج»، ولا تعتمد على ما تخفيه.
// ============================================================
export default async function MergeClientsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { with?: string };
}) {
  if (!(await canWriteCrm())) redirect(`/dashboard/clients/${params.id}`);

  const supabase = await createClient();
  const { data: self } = await supabase.from("clients").select("*").eq("id", params.id).maybeSingle();
  if (!self) notFound();
  const a = self as Client;

  const header = (
    <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
      <Link href={`/dashboard/clients/${a.id}`} className="text-sm text-gray-500 hover:text-brand-700">
        ← {a.name}
      </Link>
      <h1 className="text-xl font-bold text-brand-700">دمج بطاقتين</h1>
    </header>
  );

  // ===== بلا طرفٍ ثانٍ: اختيار البطاقة الأخرى =====
  if (!searchParams.with || searchParams.with === a.id) {
    const candidates = await getClientMatchCandidates(a.id);
    return (
      <main className="min-h-screen bg-gray-50">
        {header}
        <section className="max-w-3xl space-y-6 p-6">
          <div>
            <h2 className="mb-2 font-semibold text-gray-800">بطاقات قد تكون لـ«{a.name}»</h2>
            {candidates.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-400">
                لا بطاقة بالرقم نفسه أو باسمٍ قريب. ابحث بالاسم أو الرقم أدناه.
              </p>
            ) : (
              <ClientMatchList
                matches={candidates}
                actions={(m) => (
                  <Link
                    href={`/dashboard/clients/${a.id}/merge?with=${m.id}`}
                    className="rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                  >
                    قارن
                  </Link>
                )}
              />
            )}
          </div>
          <MergeSearch clientId={a.id} />
        </section>
      </main>
    );
  }

  // ===== البطاقتان =====
  const { data: other } = await supabase.from("clients").select("*").eq("id", searchParams.with).maybeSingle();
  if (!other) {
    return (
      <main className="min-h-screen bg-gray-50">
        {header}
        <p className="m-6 max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          البطاقة الأخرى غير متاحة لك — قد تكون دُمجت أو حُذفت، أو ليست ضمن عملائك. إن كانت عند زميل فاطلب الدمج من
          صفحة بطاقتك.
        </p>
      </main>
    );
  }
  const b = other as Client;

  const [sides, stages, projects, scopeA, scopeB] = await Promise.all([
    Promise.all([a, b].map((c) => loadSide(supabase, c))),
    getStages(),
    getProjectsLite(),
    supabase.rpc("client_merge_scope", { p_client_id: a.id }),
    supabase.rpc("client_merge_scope", { p_client_id: b.id }),
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      {header}
      <section className="p-6">
        <MergeWizard
          a={sides[0]}
          b={sides[1]}
          stages={stages.map((s) => ({ name: s.name, sort_order: s.sort_order, stage_type: s.stage_type }))}
          projects={projects}
          canMerge={scopeA.data === true && scopeB.data === true}
        />
      </section>
    </main>
  );
}

// ما يُعرض عن كل بطاقة: حقولها، واسم مالكها، وعدد ما سينتقل منها
async function loadSide(supabase: Awaited<ReturnType<typeof createClient>>, c: Client): Promise<MergeSide> {
  const count = (table: string, extra?: (q: any) => any) => {
    let q = supabase.from(table).select("id", { count: "exact", head: true }).eq("client_id", c.id);
    if (extra) q = extra(q);
    return q.then((r: { count: number | null }) => r.count ?? 0);
  };
  const [ownerName, activities, opportunities, reservations, tasks, documents] = await Promise.all([
    getOwnerName(c.owner_id),
    count("client_activities"),
    count("opportunities", (q) => q.is("deleted_at", null)),
    count("reservations"),
    count("tasks"),
    count("client_documents"),
  ]);
  return {
    client: c,
    ownerName: ownerName ?? c.sales_employee,
    counts: { activities, opportunities, reservations, tasks, documents },
  };
}
