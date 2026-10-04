import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { getCampaignsLite, getChannels, getMktProjects, getPeople, peopleMap } from "@/lib/marketing";
import { ACCOUNT_KINDS, CONTENT_STATUSES, CONTENT_TYPES, fmt } from "@/lib/marketing-style";
import { Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";

// ============================================================
// المحتوى والسوشيال — لوحة الإنتاج من الفكرة إلى النشر.
//
//   فكرة → مسودة → كتابة → تصميم → مونتاج → بانتظار الموافقة → معتمد → مجدول → منشور
//
// المنشور على السوشيال محتوىً بقناته وحسابه — لا جدول منشورات ثانٍ.
// والحسابات (فيسبوك، إنستغرام…) في تبويب «الحسابات».
// ============================================================
type Row = { id: string; code: string; title: string; content_type: string; status: string; due_date: string | null;
  publish_at: string | null; owner_id: string | null; campaign_id: string | null; channel_id: string | null; project_id: string | null };

export default async function ContentPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const sp = searchParams;
  const supabase = await createClient();
  const [write, people, campaigns, channels, projects] = await Promise.all([
    canWriteMarketing(), getPeople(), getCampaignsLite(), getChannels(), getMktProjects(),
  ]);
  const names = peopleMap(people);
  const camp = new Map(campaigns.map((c) => [c.id, c.name]));
  const ch = new Map(channels.map((c) => [c.id, c.name]));
  const today = baghdadDate();

  if (sp.tab === "accounts") {
    const { data: accounts } = await supabase.from("mkt_accounts").select("*").order("name");
    return (
      <>
        <PageHead title="حسابات التواصل والإعلانات" sub="حسابات الشركة على كل منصّة — المحتوى يُنشر من حساب، والإعلانات تُدفع من حساب إعلانات." />
        <Link href="/dashboard/marketing/content" className="text-sm text-brand-600">← لوحة المحتوى</Link>
        {write && <RecordForm table="mkt_accounts" openLabel="حساب جديد" fields={[
          { name: "name", label: "الاسم", required: true },
          { name: "kind", label: "النوع", type: "select", options: ACCOUNT_KINDS, required: true },
          { name: "channel_id", label: "القناة", type: "select", options: channels.map((c) => ({ value: c.id, label: c.name })), required: true },
          { name: "handle", label: "المعرّف @", ltr: true },
          { name: "external_id", label: "المعرّف عند المنصّة", ltr: true, hint: "رقم حساب الإعلانات act_… للمزامنة" },
          { name: "url", label: "الرابط", ltr: true },
          { name: "owner_employee_id", label: "المسؤول", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
          { name: "followers", label: "المتابعون", type: "number" },
        ]} />}
        <Card>
          <SimpleTable empty="لا حسابات." head={["الحساب", "النوع", "القناة", "المعرّف", "المتابعون", "المسؤول"]}
            rows={(accounts ?? []).map((a) => [a.name, a.kind, ch.get(a.channel_id) ?? "—", <span key="h" dir="ltr">{a.handle ?? a.external_id ?? "—"}</span>,
              fmt(a.followers), names.get(a.owner_employee_id ?? "") ?? "—"])} />
        </Card>
      </>
    );
  }

  let q = supabase.from("mkt_content").select("id, code, title, content_type, status, due_date, publish_at, owner_id, campaign_id, channel_id, project_id")
    .neq("status", "مؤرشف").order("due_date", { nullsFirst: false }).limit(600);
  if (sp.campaign) q = q.eq("campaign_id", sp.campaign);
  if (sp.project) q = q.eq("project_id", sp.project);
  if (sp.type) q = q.eq("content_type", sp.type);
  if (sp.channel) q = q.eq("channel_id", sp.channel);
  if (sp.owner) q = q.eq("owner_id", sp.owner);
  const { data } = await q;
  const rows = (data ?? []) as Row[];
  const sel = "mt-1 rounded border border-gray-300 bg-white px-2 py-1.5";

  return (
    <>
      <PageHead title="المحتوى والسوشيال" sub="كل منشور وريلز وفيديو وبروشور بمساره ومسؤوليه وموعده. التعديل بعد الاعتماد يُسقط الاعتماد ويحفظ النسخة السابقة."
        actions={<Link href="/dashboard/marketing/content?tab=accounts" className="rounded-lg border px-3 py-2 text-sm">الحسابات</Link>} />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <label><span className="text-xs text-gray-500">الحملة</span><select name="campaign" defaultValue={sp.campaign ?? ""} className={`${sel} max-w-[12rem]`}><option value="">الكل</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">المشروع</span><select name="project" defaultValue={sp.project ?? ""} className={sel}><option value="">الكل</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">النوع</span><select name="type" defaultValue={sp.type ?? ""} className={sel}><option value="">الكل</option>{CONTENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">القناة</span><select name="channel" defaultValue={sp.channel ?? ""} className={sel}><option value="">الكل</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">المسؤول</span><select name="owner" defaultValue={sp.owner ?? ""} className={sel}><option value="">الكل</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
        <button className="rounded-lg bg-brand-600 px-4 py-1.5 font-semibold text-white">طبّق</button>
      </form>

      {write && (
        <RecordForm table="mkt_content" openLabel="محتوى جديد" onSavedRedirectWithId="/dashboard/marketing/content/"
          fields={[
            { name: "title", label: "العنوان", required: true, span: 2 },
            { name: "content_type", label: "النوع", type: "select", options: CONTENT_TYPES, required: true },
            { name: "campaign_id", label: "الحملة", type: "select", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
            { name: "project_id", label: "المشروع", type: "select", options: projects.map((p) => ({ value: p.id, label: p.name })) },
            { name: "channel_id", label: "القناة", type: "select", options: channels.map((c) => ({ value: c.id, label: c.name })) },
            { name: "owner_id", label: "المسؤول", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
            { name: "due_date", label: "موعد التسليم", type: "date" },
            { name: "publish_at", label: "موعد النشر", type: "datetime" },
            { name: "brief", label: "الموجز", type: "textarea", span: 3 },
          ]} />
      )}

      <section className="flex gap-3 overflow-x-auto pb-2">
        {CONTENT_STATUSES.filter((s) => s !== "مؤرشف").map((s) => {
          const col = rows.filter((r) => r.status === s);
          return (
            <div key={s} className="w-56 shrink-0 rounded-lg bg-gray-50 p-2">
              <p className="mb-2 flex justify-between px-1 text-xs font-semibold text-gray-600"><span>{s}</span><span>{col.length}</span></p>
              <div className="space-y-2">
                {col.map((r) => {
                  const due = r.publish_at?.slice(0, 10) ?? r.due_date;
                  const late = r.due_date && r.due_date < today && !["منشور", "معتمد", "مجدول"].includes(r.status);
                  return (
                    <Link key={r.id} href={`/dashboard/marketing/content/${r.id}`}
                      className={`block rounded-lg border bg-white p-2 text-xs hover:border-brand-400 ${late ? "border-red-300" : "border-gray-200"}`}>
                      <p className="font-medium text-gray-800">{r.title}</p>
                      <p className="text-gray-500">{r.content_type}{r.channel_id ? ` · ${ch.get(r.channel_id)}` : ""}</p>
                      {r.campaign_id && <p className="truncate text-brand-700">{camp.get(r.campaign_id)}</p>}
                      <p className="mt-0.5 flex justify-between text-gray-400"><span>{names.get(r.owner_id ?? "") ?? "—"}</span><span dir="ltr" className={late ? "text-red-600" : ""}>{due ?? ""}</span></p>
                    </Link>
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
