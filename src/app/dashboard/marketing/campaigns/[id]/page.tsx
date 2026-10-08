import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { baghdadDate } from "@/lib/time";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing, isAdmin, isMarketingManager } from "@/lib/auth";
import { parseMktFilters, type MktFilters } from "@/lib/marketing-filters";
import {
  canDecideApproval, getAudiences, getCampaign, getChannels, getEntityApprovals, getFunnel, getKpis, getLeadFollowup,
  getMktProjects, getPeople, getTrend, peopleMap, type Campaign, type Channel, type Person, type ProjectLite,
} from "@/lib/marketing";
import {
  CONTENT_TYPES, EXPENSE_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES, fmt, fmtPct,
} from "@/lib/marketing-style";
import { Badge, Card, PageHead, Tile, Unavailable } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import { Columns, FunnelBars } from "@/components/marketing/charts";
import RecordForm from "@/components/marketing/record-form";
import { FieldSelect, RpcButton } from "@/components/marketing/actions";
import { campaignFields } from "../fields";
import FollowupTable from "@/components/marketing/followup-table";

// ============================================================
// مساحة الحملة — كل ما يخصّها في مكان واحد بتبويبات في الرابط.
// ============================================================

const TABS = [
  ["overview", "نظرة"], ["followup", "المتابعة"], ["channels", "القنوات"], ["content", "المحتوى"], ["ads", "الإعلانات"],
  ["offline", "الميداني"], ["influencers", "المؤثرون"], ["links", "الروابط"], ["expenses", "المصروفات"],
  ["tasks", "المهامّ"], ["approvals", "الموافقات"], ["edit", "تعديل"],
] as const;
type Tab = (typeof TABS)[number][0];

// الحالات التي تُنقل بزرّ — الاعتماد ليس منها (موافقة)، والحارس يرفض الممنوع برسالته
const MANUAL_STATUSES = ["مسودة", "تخطيط", "نشطة", "متوقفة", "مكتملة", "ملغاة"] as const;

type Ctx = { c: Campaign; write: boolean; manager: boolean; people: Person[]; channels: Channel[]; projects: ProjectLite[] };

export default async function CampaignPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string> }) {
  await requireMktRead();
  const c = await getCampaign(params.id);
  if (!c) notFound();

  const tab = (TABS.find(([k]) => k === searchParams.tab)?.[0] ?? "overview") as Tab;
  const f: MktFilters = { ...parseMktFilters(searchParams, baghdadDate(), "all"), campaign: c.id };
  const [write, manager, people, channels, projects] = await Promise.all([
    canWriteMarketing(), isMarketingManager(), getPeople(), getChannels(), getMktProjects(),
  ]);
  const ctx: Ctx = { c, write, manager, people, channels, projects };
  const names = peopleMap(people);
  const base = `/dashboard/marketing/campaigns/${c.id}`;
  const pending = c.status === "بانتظار الموافقة";

  return (
    <>
      <PageHead
        title={c.name}
        sub={`${c.campaign_type} · ${c.mode} · ${projects.find((p) => p.id === c.project_id)?.name ?? "بلا مشروع"} · ${channels.find((x) => x.id === c.channel_id)?.name ?? "بلا قناة"} · المسؤول: ${names.get(c.owner_employee_id ?? "") ?? "—"}`}
        actions={
          <>
            <span dir="ltr" className="rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-600">{c.code}</span>
            <Badge>{c.status}</Badge>
            {write && !pending && ["مسودة", "تخطيط"].includes(c.status) && (
              <RpcButton fn="mkt_request_approval" args={{ p_type: "حملة", p_id: c.id }} label="اطلب الموافقة" icon="approval"
                prompt="ملاحظة لمن يعتمد (اختيارية)" promptKey="p_note" />
            )}
            {write && !pending && <FieldSelect table="crm_campaigns" id={c.id} column="status" value={c.status} options={MANUAL_STATUSES} small={false} />}
          </>
        }
      />

      <nav className="flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.filter(([k]) => k !== "edit" || write).map(([k, label]) => (
          <Link key={k} href={`${base}?tab=${k}`}
            className={tab === k ? "-mb-px whitespace-nowrap border-b-2 border-brand-600 px-3 py-2 text-sm font-semibold text-brand-600" : "whitespace-nowrap px-3 py-2 text-sm text-gray-500 hover:text-brand-600"}>
            {label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <Overview c={c} f={f} />}
      {tab === "followup" && <FollowupTab c={c} />}
      {tab === "channels" && <ChannelsTab {...ctx} />}
      {tab === "content" && <ContentTab {...ctx} />}
      {tab === "ads" && <AdsTab {...ctx} />}
      {tab === "offline" && <OfflineTab {...ctx} />}
      {tab === "influencers" && <InfluencersTab {...ctx} />}
      {tab === "links" && <LinksTab {...ctx} />}
      {tab === "expenses" && <ExpensesTab {...ctx} />}
      {tab === "tasks" && <TasksTab {...ctx} />}
      {tab === "approvals" && <ApprovalsTab {...ctx} />}
      {tab === "edit" && write && <EditTab {...ctx} />}
    </>
  );
}

async function Overview({ c, f }: { c: Campaign; f: MktFilters }) {
  const [kpis, funnel, trend] = await Promise.all([getKpis(f), getFunnel(f), getTrend("week", { ...f, from: c.start_date ?? f.from })]);
  const k = kpis.data;
  const vs = (actual: number | null | undefined, expected: number | null) =>
    expected ? `${fmt(actual)} / ${fmt(expected)}` : fmt(actual);
  const pctOf = (actual: number | null | undefined, expected: number | null) =>
    expected ? `${fmtPct(((Number(actual) || 0) * 100) / expected)} من المتوقّع` : undefined;
  return (
    <>
      <Unavailable error={kpis.error} />
      {k && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Tile label="الكلفة" value={fmt(k.cost)} sub={c.budget ? `من ميزانية ${fmt(c.budget)}` : "بلا ميزانية"}
            tone={c.budget && k.cost > Number(c.budget) ? "bad" : undefined} />
          <Tile label="ليدات" value={vs(k.leads, c.expected_leads)} sub={pctOf(k.leads, c.expected_leads)} />
          <Tile label="مؤهَّلون" value={vs(k.qualified, c.expected_qualified)} sub={pctOf(k.qualified, c.expected_qualified)} />
          <Tile label="حجوزات" value={vs(k.reservations, c.expected_reservations)} sub={pctOf(k.reservations, c.expected_reservations)} />
          <Tile label="بيعات منسوبة" value={vs(k.sales, c.expected_sales)} tone="brand" sub={pctOf(k.sales, c.expected_sales)} />
          <Tile label="عمولة تلال" value={vs(k.commission, c.expected_revenue)} tone="brand" sub={pctOf(k.commission, c.expected_revenue)} />
          <Tile label="CPL" value={fmt(k.cpl)} sub={c.target_cpl ? `الهدف ${fmt(c.target_cpl)}` : undefined}
            tone={c.target_cpl && k.cpl && k.cpl > Number(c.target_cpl) ? "warn" : undefined} />
          <Tile label="CPQL" value={fmt(k.cpql)} />
          <Tile label="CAC" value={fmt(k.cac)} />
          <Tile label="ROAS" value={k.roas == null ? "—" : `${fmt(k.roas)}×`} />
          <Tile label="ROI" value={fmtPct(k.roi)} tone={k.roi == null ? undefined : k.roi >= 0 ? "brand" : "bad"} />
          <Tile label="نقرات" value={fmt(k.clicks)} sub={`CTR ${fmtPct(k.ctr)} · مسوح QR ${fmt(k.scans)}`} />
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="القمع"><FunnelBars steps={funnel.data} /></Card>
        <div className="space-y-4">
          <Card title="الليدات أسبوعياً"><Columns points={trend.data.map((t) => ({ key: t.period, label: t.period, value: Number(t.leads) }))} unit="ليد" /></Card>
          <Card title="الكلفة أسبوعياً"><Columns points={trend.data.map((t) => ({ key: t.period, label: t.period, value: Number(t.cost) }))} unit="د.ع" /></Card>
        </div>
      </div>
      {c.objective && <Card title="الهدف"><p className="text-sm text-gray-700">{c.objective}</p></Card>}
    </>
  );
}

// Did the campaign's leads reach anyone in sales? — totals per responsible employee, not client names (092)
async function FollowupTab({ c }: { c: Campaign }) {
  const { data, error } = await getLeadFollowup(null, null, c.id);
  return (
    <Card title="متابعة ليدات الحملة عند المبيعات">
      <Unavailable error={error} />
      <FollowupTable rows={data} />
      <p className="mt-2 text-xs text-gray-500">«متروك» = ليدٌ مفتوح لم يُتصل به بعد مرور يومين على دخوله — المصروف يضيع هنا. إعادة توزيعه من شاشة التوزيع في الـCRM.</p>
    </Card>
  );
}

async function ChannelsTab({ c, write, channels }: Ctx) {
  const supabase = await createClient();
  const { data } = await supabase.from("mkt_campaign_channels").select("channel_id, planned_budget").eq("campaign_id", c.id);
  const used = new Set((data ?? []).map((r) => r.channel_id));
  const name = new Map(channels.map((x) => [x.id, x.name]));
  return (
    <Card title="قنوات الحملة وميزانياتها المخطّطة">
      {write && (
        <div className="mb-4">
          <RecordForm table="mkt_campaign_channels" openLabel="أضف قناة" fixed={{ campaign_id: c.id }} returnsId={false}
            fields={[
              { name: "channel_id", label: "القناة", type: "select", required: true,
                options: channels.filter((x) => x.is_active && !used.has(x.id)).map((x) => ({ value: x.id, label: x.name })) },
              { name: "planned_budget", label: "الميزانية المخطّطة", type: "number" },
            ]} />
        </div>
      )}
      <SimpleTable head={["القناة", "الميزانية المخطّطة"]}
        rows={(data ?? []).map((r) => [name.get(r.channel_id) ?? "—", fmt(r.planned_budget)])} />
      <p className="mt-2 text-xs text-gray-500">الحملة الهجينة تُربط بكل قنواتها هنا؛ الكلفة الفعلية من المصروفات لا من هذه الأرقام.</p>
    </Card>
  );
}

async function ContentTab({ c, write, people }: Ctx) {
  const supabase = await createClient();
  const names = peopleMap(people);
  const { data } = await supabase.from("mkt_content").select("id, code, title, content_type, status, due_date, publish_at, owner_id")
    .eq("campaign_id", c.id).order("created_at", { ascending: false });
  return (
    <Card title="محتوى الحملة">
      {write && <div className="mb-4"><RecordForm table="mkt_content" openLabel="محتوى جديد" fixed={{ campaign_id: c.id, project_id: c.project_id, channel_id: c.channel_id }}
        fields={[
          { name: "title", label: "العنوان", required: true, span: 2 },
          { name: "content_type", label: "النوع", type: "select", options: CONTENT_TYPES, required: true },
          { name: "owner_id", label: "المسؤول", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
          { name: "due_date", label: "موعد التسليم", type: "date" },
          { name: "brief", label: "الموجز", type: "textarea", span: 3 },
        ]} /></div>}
      <SimpleTable head={["الرمز", "العنوان", "النوع", "الحالة", "المسؤول", "الموعد"]}
        rows={(data ?? []).map((x) => [
          <span key="c" dir="ltr" className="font-mono text-xs">{x.code}</span>,
          <Link key="t" href={`/dashboard/marketing/content/${x.id}`} className="hover:text-brand-600">{x.title}</Link>,
          x.content_type, <Badge key="s">{x.status}</Badge>, names.get(x.owner_id ?? "") ?? "—",
          <span key="d" dir="ltr">{x.publish_at?.slice(0, 10) ?? x.due_date ?? "—"}</span>,
        ])} />
    </Card>
  );
}

async function AdsTab({ c }: Ctx) {
  const supabase = await createClient();
  const { data } = await supabase.from("mkt_ad_objects").select("id, level, name, external_id, status, daily_budget, lifetime_budget")
    .eq("campaign_id", c.id).order("level").order("name");
  return (
    <Card title="الحملات الإعلانية ومجموعاتها وإعلاناتها" actions={<Link href="/dashboard/marketing/ads" className="text-xs text-brand-600 hover:underline">إدارة الإعلانات</Link>}>
      <SimpleTable head={["المستوى", "الاسم", "المعرّف عند المنصّة", "الحالة", "يومي", "إجمالي"]}
        rows={(data ?? []).map((x) => [x.level, x.name, <span key="e" dir="ltr">{x.external_id ?? "—"}</span>, <Badge key="s">{x.status}</Badge>, fmt(x.daily_budget), fmt(x.lifetime_budget)])} />
    </Card>
  );
}

async function OfflineTab({ c }: Ctx) {
  const supabase = await createClient();
  const { data } = await supabase.from("mkt_activities").select("id, kind, title, city, start_date, end_date, status, budget")
    .eq("campaign_id", c.id).order("start_date", { ascending: false, nullsFirst: false });
  return (
    <Card title="الأنشطة الميدانية والفعاليات" actions={<Link href={`/dashboard/marketing/offline?campaign=${c.id}`} className="text-xs text-brand-600 hover:underline">نشاط جديد</Link>}>
      <SimpleTable head={["النشاط", "النوع", "المدينة", "المدة", "الحالة", "الميزانية"]}
        rows={(data ?? []).map((x) => [
          <Link key="t" href={`/dashboard/marketing/offline/${x.id}`} className="hover:text-brand-600">{x.title}</Link>,
          x.kind, x.city ?? "—", <span key="d" dir="ltr">{x.start_date ?? "—"} → {x.end_date ?? "—"}</span>, <Badge key="s">{x.status}</Badge>, fmt(x.budget)])} />
    </Card>
  );
}

async function InfluencersTab({ c }: Ctx) {
  const supabase = await createClient();
  const { data } = await supabase.from("mkt_influencer_deals").select("id, stage, quoted_rate, negotiated_rate, due_date, mkt_influencers(name)")
    .eq("campaign_id", c.id);
  return (
    <Card title="صفقات المؤثرين" actions={<Link href="/dashboard/marketing/influencers" className="text-xs text-brand-600 hover:underline">قاعدة المؤثرين</Link>}>
      <SimpleTable head={["المؤثر", "المرحلة", "السعر المعروض", "المتفق", "التسليم"]}
        rows={(data ?? []).map((x) => {
          const inf = x.mkt_influencers as unknown as { name: string } | null;
          return [inf?.name ?? "—", <Badge key="s">{x.stage}</Badge>, fmt(x.quoted_rate), fmt(x.negotiated_rate), <span key="d" dir="ltr">{x.due_date ?? "—"}</span>];
        })} />
    </Card>
  );
}

async function LinksTab({ c }: Ctx) {
  const supabase = await createClient();
  const { data } = await supabase.from("mkt_tracking_links").select("id, code, name, utm_source, utm_medium, utm_content, is_qr")
    .eq("campaign_id", c.id).order("created_at", { ascending: false });
  const ids = (data ?? []).map((l) => l.id);
  const { data: hits } = ids.length
    ? await supabase.from("mkt_link_hits").select("link_id").in("link_id", ids).limit(50000)
    : { data: [] as { link_id: string }[] };
  const count = new Map<string, number>();
  for (const h of hits ?? []) count.set(h.link_id, (count.get(h.link_id) ?? 0) + 1);
  return (
    <Card title="روابط التتبّع و QR" actions={<Link href={`/dashboard/marketing/tracking?campaign=${c.id}`} className="text-xs text-brand-600 hover:underline">رابط جديد</Link>}>
      <SimpleTable head={["الاسم", "الرمز", "UTM", "QR", "نقرات ومسوح"]}
        rows={(data ?? []).map((l) => [l.name, <span key="c" dir="ltr" className="font-mono text-xs">{l.code}</span>,
          <span key="u" dir="ltr" className="text-xs">{l.utm_source}/{l.utm_medium}{l.utm_content ? `/${l.utm_content}` : ""}</span>,
          l.is_qr ? "نعم" : "—", fmt(count.get(l.id) ?? 0)])} />
    </Card>
  );
}

async function ExpensesTab({ c, write }: Ctx) {
  const supabase = await createClient();
  const { data } = await supabase.from("mkt_expenses").select("id, code, expense_date, category, description, amount_iqd, status")
    .eq("campaign_id", c.id).order("expense_date", { ascending: false });
  return (
    <Card title="مصروفات الحملة" actions={<span className="text-xs text-gray-500">الميزانية {fmt(c.budget)} · المدفوع {fmt(c.spent)}</span>}>
      {write && <div className="mb-4"><RecordForm table="mkt_expenses" openLabel="مصروف جديد"
        fixed={{ campaign_id: c.id, project_id: c.project_id, channel_id: c.channel_id }}
        fields={[
          { name: "description", label: "البيان", required: true, span: 2 },
          { name: "category", label: "التصنيف", type: "select", options: EXPENSE_CATEGORIES, required: true },
          { name: "amount", label: "المبلغ", type: "number", required: true },
          { name: "currency", label: "العملة", type: "select", options: ["IQD", "USD"], required: true },
          { name: "fx_rate", label: "سعر الصرف", type: "number", hint: "١ للدينار؛ للدولار: كم ديناراً للدولار" },
          { name: "expense_date", label: "التاريخ", type: "date" },
          { name: "invoice_ref", label: "رقم الفاتورة" },
        ]} initial={{ currency: "IQD", fx_rate: "1" }} /></div>}
      <SimpleTable head={["الرمز", "التاريخ", "البيان", "التصنيف", "المبلغ", "الحالة"]}
        rows={(data ?? []).map((x) => [<span key="c" dir="ltr" className="font-mono text-xs">{x.code}</span>, <span key="d" dir="ltr">{x.expense_date}</span>,
          x.description, x.category, fmt(x.amount_iqd), <Badge key="s">{x.status}</Badge>])} />
      <p className="mt-2 text-xs text-gray-500">طلب الاعتماد والدفع من <Link href="/dashboard/marketing/expenses" className="text-brand-600 hover:underline">المصروفات</Link> — الدفع للمالية ويُرحَّل على 5700.</p>
    </Card>
  );
}

async function TasksTab({ c, write, people }: Ctx) {
  const supabase = await createClient();
  const names = peopleMap(people);
  const { data } = await supabase.from("mkt_tasks").select("id, title, assignee_id, priority, due_date, status")
    .eq("campaign_id", c.id).order("due_date", { nullsFirst: false });
  return (
    <Card title="مهامّ الحملة">
      {write && <div className="mb-4"><RecordForm table="mkt_tasks" openLabel="مهمّة جديدة" fixed={{ campaign_id: c.id, project_id: c.project_id }}
        fields={[
          { name: "title", label: "المهمّة", required: true, span: 2 },
          { name: "assignee_id", label: "المكلَّف", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
          { name: "priority", label: "الأولوية", type: "select", options: TASK_PRIORITIES, required: true },
          { name: "due_date", label: "الموعد", type: "date" },
          { name: "description", label: "التفاصيل", type: "textarea", span: 3 },
        ]} initial={{ priority: "عادية" }} /></div>}
      <SimpleTable head={["المهمّة", "المكلَّف", "الأولوية", "الموعد", "الحالة"]}
        rows={(data ?? []).map((t) => [t.title, names.get(t.assignee_id ?? "") ?? "—", t.priority, <span key="d" dir="ltr">{t.due_date ?? "—"}</span>,
          write ? <FieldSelect key="s" table="mkt_tasks" id={t.id} column="status" value={t.status} options={TASK_STATUSES} /> : t.status])} />
    </Card>
  );
}

async function ApprovalsTab({ c, manager }: Ctx) {
  const [rows, admin] = await Promise.all([getEntityApprovals("حملة", c.id), isAdmin()]);
  const open = rows.find((a) => a.status === "معلّق");
  const decide = open ? canDecideApproval(open, { admin, manager }) : false;
  return (
    <Card title="سجلّ الموافقات">
      <SimpleTable head={["الطلب", "طلبه", "يعتمده", "الحالة", "القرار", "السبب"]}
        rows={rows.map((a) => [<span key="d" dir="ltr">{a.requested_at.slice(0, 16).replace("T", " ")}</span>, a.requested_by_name ?? "—", a.approver,
          <Badge key="s">{a.status}</Badge>, a.decided_by_name ? `${a.decided_by_name} · ${a.decided_at?.slice(0, 10)}` : "—", a.reason ?? a.escalated_reason ?? "—"])} />
      {open && (
        <div className="mt-3 flex flex-wrap gap-2">
          {decide && <RpcButton fn="mkt_decide_approval" args={{ p_id: open.id, p_approve: true }} label="اعتمد" icon="check" />}
          {decide && <RpcButton fn="mkt_decide_approval" args={{ p_id: open.id, p_approve: false }} label="ارفض" tone="danger"
            prompt="سبب الرفض — يصل إلى من طلب" promptKey="p_reason" promptRequired />}
          {!decide && <span className="self-center text-xs text-amber-700">بانتظار اعتماد {open.approver}{open.escalated_reason ? ` — ${open.escalated_reason}` : ""}</span>}
          <RpcButton fn="mkt_cancel_approval" args={{ p_id: open.id }} label="اسحب الطلب" tone="plain" confirm="سحب طلب الموافقة؟" />
        </div>
      )}
    </Card>
  );
}

async function EditTab({ c, people, channels, projects }: Ctx) {
  const supabase = await createClient();
  const [audiences, { data: plans }] = await Promise.all([
    getAudiences(), supabase.from("mkt_plans").select("id, title").order("period_start", { ascending: false }),
  ]);
  return (
    <RecordForm table="crm_campaigns" id={c.id} initial={c as unknown as Record<string, unknown>}
      fields={campaignFields({ projects, channels, people, audiences, plans: plans ?? [] })} submitLabel="احفظ التعديل" />
  );
}
