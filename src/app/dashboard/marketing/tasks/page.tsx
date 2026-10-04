import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { getCampaignsLite, getPeople, peopleMap } from "@/lib/marketing";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/marketing-style";
import { PageHead } from "@/components/marketing/ui";
import RecordForm from "@/components/marketing/record-form";
import { FieldSelect } from "@/components/marketing/actions";
import Checklist from "./checklist";

// ============================================================
// مهامّ التسويق — لوحة بخمس حالات، وعبء كل عضو في الفريق.
//
// جدولٌ منفصل عن tasks الـCRM (انظر 121 §11): مهمّة تصميم بروشور ليست
// نشاط مبيعات، ولا تدخل تقارير أداء الموظفين في الـCRM.
// ============================================================
type Task = {
  id: string; title: string; description: string | null; campaign_id: string | null; content_id: string | null;
  activity_id: string | null; assignee_id: string | null; priority: string; due_date: string | null; status: string;
  depends_on: string | null; checklist: { text: string; done: boolean }[]; blocked_reason: string | null;
};

export default async function TasksPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const supabase = await createClient();
  let q = supabase.from("mkt_tasks").select("*").order("due_date", { nullsFirst: false }).limit(500);
  if (searchParams.assignee) q = q.eq("assignee_id", searchParams.assignee);
  if (searchParams.campaign) q = q.eq("campaign_id", searchParams.campaign);
  const [{ data }, write, people, campaigns] = await Promise.all([q, canWriteMarketing(), getPeople(), getCampaignsLite()]);
  const tasks = (data ?? []) as Task[];
  const names = peopleMap(people);
  const camp = new Map(campaigns.map((c) => [c.id, c.name]));
  const titles = new Map(tasks.map((t) => [t.id, t]));
  const today = baghdadDate();

  // العبء: المفتوح لكل عضو، والمتأخّر منه
  const load = new Map<string, { open: number; late: number }>();
  for (const t of tasks) {
    if (t.status === "منجزة" || !t.assignee_id) continue;
    const x = load.get(t.assignee_id) ?? { open: 0, late: 0 };
    x.open += 1;
    if (t.due_date && t.due_date < today) x.late += 1;
    load.set(t.assignee_id, x);
  }

  return (
    <>
      <PageHead title="مهامّ التسويق" sub="كاتب المحتوى ← المصمّم ← المصوّر ← المونتير ← المراجعة: كل خطوة مهمّة لها مكلَّفها وموعدها وما تعتمد عليه." />

      <section className="flex flex-wrap gap-2 text-xs">
        <Link href="/dashboard/marketing/tasks" className="rounded-full border px-3 py-1">الكل</Link>
        {Array.from(load.entries()).sort((a, b) => b[1].open - a[1].open).map(([id, x]) => (
          <Link key={id} href={`/dashboard/marketing/tasks?assignee=${id}`}
            className={`rounded-full border px-3 py-1 ${searchParams.assignee === id ? "border-brand-600 bg-brand-50" : ""}`}>
            {names.get(id) ?? "—"}: {x.open} مفتوحة{x.late ? <span className="text-red-600"> · {x.late} متأخّرة</span> : null}
          </Link>
        ))}
      </section>

      {write && (
        <RecordForm table="mkt_tasks" openLabel="مهمّة جديدة" initial={{ priority: "عادية" }}
          fields={[
            { name: "title", label: "المهمّة", required: true, span: 2 },
            { name: "assignee_id", label: "المكلَّف", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name + (p.mkt_role ? ` — ${p.mkt_role}` : "") })) },
            { name: "campaign_id", label: "الحملة", type: "select", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
            { name: "priority", label: "الأولوية", type: "select", options: TASK_PRIORITIES, required: true },
            { name: "due_date", label: "الموعد", type: "date" },
            { name: "depends_on", label: "تعتمد على", type: "select", options: tasks.filter((t) => t.status !== "منجزة").map((t) => ({ value: t.id, label: t.title })) },
            { name: "description", label: "التفاصيل", type: "textarea", span: 3 },
          ]} />
      )}

      <section className="grid gap-3 overflow-x-auto md:grid-cols-5">
        {TASK_STATUSES.map((s) => {
          const col = tasks.filter((t) => t.status === s);
          return (
            <div key={s} className="min-w-[220px] rounded-lg bg-gray-50 p-2">
              <p className="mb-2 flex justify-between px-1 text-xs font-semibold text-gray-600"><span>{s}</span><span>{col.length}</span></p>
              <div className="space-y-2">
                {col.map((t) => {
                  const late = t.due_date && t.due_date < today && t.status !== "منجزة";
                  const dep = t.depends_on ? titles.get(t.depends_on) : null;
                  return (
                    <div key={t.id} className={`rounded-lg border bg-white p-2 text-xs ${late ? "border-red-300" : "border-gray-200"}`}>
                      <p className="font-medium text-gray-800">{t.title}</p>
                      <p className="mt-0.5 text-gray-500">{names.get(t.assignee_id ?? "") ?? "بلا مكلَّف"} · {t.priority}</p>
                      {t.due_date && <p className={late ? "text-red-600" : "text-gray-400"} dir="ltr">{t.due_date}</p>}
                      {t.campaign_id && <Link href={`/dashboard/marketing/campaigns/${t.campaign_id}`} className="block truncate text-brand-600">{camp.get(t.campaign_id)}</Link>}
                      {dep && <p className={dep.status === "منجزة" ? "text-gray-400" : "text-amber-700"}>تعتمد على: {dep.title}</p>}
                      {t.blocked_reason && <p className="text-red-600">{t.blocked_reason}</p>}
                      <Checklist id={t.id} items={t.checklist ?? []} canEdit={write} />
                      {write && <div className="mt-1"><FieldSelect table="mkt_tasks" id={t.id} column="status" value={t.status} options={TASK_STATUSES} /></div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
