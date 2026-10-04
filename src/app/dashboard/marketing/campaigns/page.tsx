import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing } from "@/lib/auth";
import { getChannels, getMktProjects, getPeople, peopleMap, type Campaign } from "@/lib/marketing";
import { CAMPAIGN_STATUSES, CAMPAIGN_TYPES, fmt } from "@/lib/marketing-style";
import { Badge, Empty, PageHead } from "@/components/marketing/ui";
import Pager from "@/components/pager";

const PAGE = 50;

// قائمة الحملات — بمُرشِّحات في الرابط (حالة، نوع، مشروع، قناة، مسؤول، بحث)
export default async function CampaignsList({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const sp = searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let q = supabase.from("crm_campaigns").select("*", { count: "exact" });
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.type) q = q.eq("campaign_type", sp.type);
  if (sp.project) q = q.eq("project_id", sp.project);
  if (sp.channel) q = q.eq("channel_id", sp.channel);
  if (sp.owner) q = q.eq("owner_employee_id", sp.owner);
  if (sp.mode) q = q.eq("mode", sp.mode);
  if (sp.q) q = q.or(`name.ilike.%${sp.q.replace(/[%,()]/g, "")}%,code.ilike.%${sp.q.replace(/[%,()]/g, "")}%`);
  q = q.order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);

  const [{ data, count, error }, projects, channels, people, write] = await Promise.all([
    q, getMktProjects(), getChannels(), getPeople(), canWriteMarketing(),
  ]);
  const rows = (data ?? []) as Campaign[];
  const pName = new Map(projects.map((p) => [p.id, p.name]));
  const cName = new Map(channels.map((c) => [c.id, c.name]));
  const owners = peopleMap(people);
  const params = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "page" && v));
  const sel = "mt-1 rounded border border-gray-300 bg-white px-2 py-1.5";

  return (
    <>
      <PageHead
        title="الحملات"
        sub="كل حملة برمزها (utm_campaign) وحالتها وكلفتها. المصروف يُحسب من المصروفات المدفوعة — لا يُكتب باليد."
        actions={write && <Link href="/dashboard/marketing/campaigns/new" className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700">حملة جديدة</Link>}
      />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <label className="block"><span className="text-xs text-gray-500">بحث</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="اسم أو رمز" className={sel} /></label>
        <label className="block"><span className="text-xs text-gray-500">الحالة</span>
          <select name="status" defaultValue={sp.status ?? ""} className={sel}><option value="">الكل</option>
            {CAMPAIGN_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="block"><span className="text-xs text-gray-500">النوع</span>
          <select name="type" defaultValue={sp.type ?? ""} className={sel}><option value="">الكل</option>
            {CAMPAIGN_TYPES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="block"><span className="text-xs text-gray-500">المشروع</span>
          <select name="project" defaultValue={sp.project ?? ""} className={sel}><option value="">الكل</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="block"><span className="text-xs text-gray-500">القناة</span>
          <select name="channel" defaultValue={sp.channel ?? ""} className={sel}><option value="">الكل</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block"><span className="text-xs text-gray-500">المسؤول</span>
          <select name="owner" defaultValue={sp.owner ?? ""} className={sel}><option value="">الكل</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
        <button className="rounded-lg bg-brand-600 px-4 py-1.5 font-semibold text-white">طبّق</button>
      </form>

      {error && <p className="text-sm text-red-700">{error.message}</p>}
      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-right text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>{["الحملة", "الحالة", "النوع", "المشروع / القناة", "المسؤول", "المدة", "الميزانية", "المصروف", "ليدات متوقعة"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((c) => {
              const over = c.budget && c.spent && Number(c.spent) > Number(c.budget);
              return (
                <tr key={c.id} className={c.is_active ? "" : "opacity-60"}>
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/marketing/campaigns/${c.id}`} className="font-medium text-gray-800 hover:text-brand-600">{c.name}</Link>
                    <p className="text-xs text-gray-400" dir="ltr">{c.code}</p>
                  </td>
                  <td className="px-3 py-2"><Badge>{c.status}</Badge></td>
                  <td className="px-3 py-2 text-xs text-gray-600">{c.campaign_type} · {c.mode}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{pName.get(c.project_id ?? "") ?? "—"}<br />{cName.get(c.channel_id ?? "") ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{owners.get(c.owner_employee_id ?? "") ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-500" dir="ltr">{c.start_date ?? "—"}{c.end_date ? ` → ${c.end_date}` : ""}</td>
                  <td className="px-3 py-2 tabular-nums">{fmt(c.budget)}</td>
                  <td className={`px-3 py-2 tabular-nums ${over ? "font-semibold text-red-600" : ""}`}>{fmt(c.spent)}</td>
                  <td className="px-3 py-2 tabular-nums">{fmt(c.expected_leads)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>لا حملات بهذه المُرشِّحات.</Empty>}
      </section>
      <Pager total={count ?? 0} page={page} pageSize={PAGE} basePath="/dashboard/marketing/campaigns" params={params} unit="حملة" />
    </>
  );
}
