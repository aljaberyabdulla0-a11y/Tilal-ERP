import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { parseMktFilters } from "@/lib/marketing-filters";
import { getBreakdown, getCampaignsLite, getChannels, getMarketingVendors, getMktProjects, getPeople } from "@/lib/marketing";
import { ACTIVITY_KINDS, ACTIVITY_STATUSES, EVENT_KINDS, fmt, fmtPct } from "@/lib/marketing-style";
import { Badge, Card, PageHead, Tile } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";

// ============================================================
// التسويق الميداني والفعاليات والمعارض.
//
// اللوحة الإعلانية والمعرض جدولٌ واحد بنوعه (121 §10). وأثر الميداني
// يُقاس كما يُقاس الرقمي: كل نشاطٍ برمز QR أو رابط خاصّ، فالليد الذي
// مسح لوحة طريق المطار يُنسب إليها — لا إلى «مرّ من المنطقة».
// ============================================================
export default async function OfflinePage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const sp = searchParams;
  const supabase = await createClient();
  let q = supabase.from("mkt_activities").select("*").order("start_date", { ascending: false, nullsFirst: false }).limit(300);
  if (sp.category) q = q.eq("category", sp.category);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.project) q = q.eq("project_id", sp.project);
  if (sp.campaign) q = q.eq("campaign_id", sp.campaign);
  const [{ data }, write, projects, campaigns, channels, vendors, people, perf] = await Promise.all([
    q, canWriteMarketing(), getMktProjects(), getCampaignsLite(), getChannels(), getMarketingVendors(), getPeople(),
    getBreakdown("activity", parseMktFilters({ range: "all" }, baghdadDate())),
  ]);
  const rows = data ?? [];
  const perfBy = new Map(perf.data.map((p) => [p.dim_key, p]));
  const pName = new Map(projects.map((p) => [p.id, p.name]));
  const today = baghdadDate();
  const live = rows.filter((a) => ["معتمد", "قيد التنفيذ", "نشط"].includes(a.status));
  const sel = "mt-1 rounded border border-gray-300 bg-white px-2 py-1.5";

  return (
    <>
      <PageHead title="الميداني والفعاليات والمعارض"
        sub="لوحات وطرق ومولات ومطبوعات وإذاعة وتلفزيون ومعارض وفعاليات — لكلٍّ مكانه ومورّده وكلفته ورمزه وليداته." />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="جارية الآن" value={fmt(live.length)} />
        <Tile label="تنتهي خلال ٧ أيام" value={fmt(live.filter((a) => a.end_date && a.end_date >= today && a.end_date <= addDays(today, 7)).length)} tone="warn" />
        <Tile label="فعاليات ومعارض قادمة" value={fmt(rows.filter((a) => a.category === "فعالية" && a.start_date && a.start_date >= today).length)} />
        <Tile label="ليدات منسوبة (كل الوقت)" value={fmt(perf.data.reduce((s, p) => s + (p.dim_key ? Number(p.leads) : 0), 0))} tone="brand" />
      </section>

      {write && (
        <RecordForm table="mkt_activities" openLabel="نشاط أو فعالية" title="نشاط ميداني أو فعالية" onSavedRedirectWithId="/dashboard/marketing/offline/"
          initial={{ kind: "لوحة إعلانية", campaign_id: sp.campaign ?? "" }}
          fields={[
            { name: "title", label: "العنوان", required: true, span: 2, placeholder: "لوحة طريق المطار — لاماك" },
            { name: "kind", label: "النوع", type: "select", options: ACTIVITY_KINDS, required: true },
            { name: "campaign_id", label: "الحملة", type: "select", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
            { name: "project_id", label: "المشروع", type: "select", options: projects.map((p) => ({ value: p.id, label: p.name })) },
            { name: "channel_id", label: "القناة", type: "select", options: channels.filter((c) => c.mode === "ميداني").map((c) => ({ value: c.id, label: c.name })) },
            { name: "vendor_id", label: "المورّد", type: "select", options: vendors.map((v) => ({ value: v.id, label: v.name })) },
            { name: "city", label: "المدينة" },
            { name: "location", label: "الموقع", placeholder: "تقاطع … باتجاه …" },
            { name: "venue", label: "القاعة / المكان (للفعالية)" },
            { name: "start_date", label: "من", type: "date" },
            { name: "end_date", label: "إلى", type: "date" },
            { name: "budget", label: "الميزانية", type: "number" },
            { name: "quantity", label: "الكمية", type: "number", hint: "عدد اللوحات أو النسخ" },
            { name: "dimensions", label: "الأبعاد", placeholder: "12×4 م" },
            { name: "expected_visitors", label: "زوّار متوقعون", type: "number" },
            { name: "responsible_employee_id", label: "المسؤول", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
            { name: "audience", label: "الجمهور" },
            { name: "objective", label: "الهدف", span: 2 },
          ]} />
      )}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <label><span className="text-xs text-gray-500">الفئة</span><select name="category" defaultValue={sp.category ?? ""} className={sel}><option value="">الكل</option><option>ميداني</option><option>فعالية</option></select></label>
        <label><span className="text-xs text-gray-500">الحالة</span><select name="status" defaultValue={sp.status ?? ""} className={sel}><option value="">الكل</option>{ACTIVITY_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">المشروع</span><select name="project" defaultValue={sp.project ?? ""} className={sel}><option value="">الكل</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">الحملة</span><select name="campaign" defaultValue={sp.campaign ?? ""} className={`${sel} max-w-[12rem]`}><option value="">الكل</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button className="rounded-lg bg-brand-600 px-4 py-1.5 font-semibold text-white">طبّق</button>
      </form>

      <Card>
        <SimpleTable empty="لا أنشطة."
          head={["النشاط", "النوع", "المشروع", "المكان", "المدة", "الحالة", "الميزانية", "الكلفة", "ليدات", "بيع", "CPL", "ROI"]}
          rows={rows.map((a) => {
            const p = perfBy.get(a.id);
            const ending = a.end_date && a.end_date >= today && a.end_date <= addDays(today, 7);
            return [
              <Link key="t" href={`/dashboard/marketing/offline/${a.id}`} className="font-medium hover:text-brand-600">{a.title}<span className="block text-xs text-gray-400" dir="ltr">{a.code}</span></Link>,
              <span key="k" className="text-xs">{a.kind}{(EVENT_KINDS as readonly string[]).includes(a.kind) ? " ★" : ""}</span>,
              pName.get(a.project_id ?? "") ?? "—",
              <span key="l" className="text-xs">{[a.city, a.location ?? a.venue].filter(Boolean).join(" — ") || "—"}</span>,
              <span key="d" dir="ltr" className={`text-xs ${ending ? "text-amber-700" : ""}`}>{a.start_date ?? "—"} → {a.end_date ?? "—"}</span>,
              <Badge key="s">{a.status}</Badge>, fmt(a.budget), fmt(p?.cost), fmt(p?.leads), fmt(p?.sales), fmt(p?.cpl), fmtPct(p?.roi),
            ];
          })} />
      </Card>
    </>
  );
}

function addDays(iso: string, d: number) {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
}
