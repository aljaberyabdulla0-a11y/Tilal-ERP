import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canWriteCrm } from "@/lib/auth";
import type { Client } from "@/lib/types";
import { getClientMatchCandidates, getOwnerName, getProjectsLite, getStages, type MergePeer } from "@/lib/crm";
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
// الصلاحية تُقرَّر في القاعدة (client_merge_mode، sql/169): تطابق
// الرقم أو الاسم ⇒ «ادمج» ولو كانت الأخرى عند زميل، وإلا «اطلب الدمج»
// من مشرف الفريق. الصفحة تسألها ولا تعتمد على ما تخفيه.
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
  // بطاقة الزميل لا تمرّ من RLS؛ حين يحقّ الدمج (تطابق أو طلبٌ ينتظر
  // المشرف) تقرؤها القاعدة لشاشة المقارنة (169).
  const [{ data: visible }, { data: peerData }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", searchParams.with).maybeSingle(),
    supabase.rpc("client_merge_peer", { p_client_id: a.id, p_other: searchParams.with }),
  ]);
  const peer = peerData as MergePeer | null;
  const other = (visible as Client | null) ?? peer?.client ?? null;
  if (!other || !peer) {
    return (
      <main className="min-h-screen bg-gray-50">
        {header}
        <p className="m-6 max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          البطاقة الأخرى غير متاحة لك — قد تكون دُمجت أو حُذفت، أو هي عند زميل ولا تتطابق مع بطاقتك بالرقم أو
          بالاسم. فاطلب الدمج من مشرف الفريق من صفحة بطاقتك.
        </p>
      </main>
    );
  }
  const b = other;

  const [sideA, sideB, stages, projects] = await Promise.all([
    loadSide(supabase, a),
    visible
      ? loadSide(supabase, b)
      : Promise.resolve<MergeSide>({ client: b, ownerName: peer.owner_name, counts: peer.counts }),
    getStages(),
    getProjectsLite(),
  ]);
  const sides = [sideA, sideB];

  return (
    <main className="min-h-screen bg-gray-50">
      {header}
      <section className="p-6">
        <MergeWizard
          a={sides[0]}
          b={sides[1]}
          stages={stages.map((s) => ({ name: s.name, sort_order: s.sort_order, stage_type: s.stage_type }))}
          projects={projects}
          canMerge={peer.mode === "direct"}
          ownerLocked={peer.owner_locked}
          matchOn={peer.match_on}
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
