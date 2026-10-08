import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing, isAdmin, isMarketingManager } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { parseMktFilters } from "@/lib/marketing-filters";
import { canDecideApproval, getBreakdown, getCampaignsLite, getChannels, getMarketingVendors } from "@/lib/marketing";
import { DEAL_STAGES, fmt, fmtPct } from "@/lib/marketing-style";
import { Badge, Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";
import { FieldSelect, RpcButton } from "@/components/marketing/actions";
import MetricEntry from "@/components/marketing/metric-entry";

// ============================================================
// المؤثرون — قاعدة بياناتهم، وصفقاتهم بمراحلها، وأداؤهم بالمال.
//
//   بحث → قائمة مختصرة → تواصل → تفاوض → [اعتماد] → عقد → محتوى →
//   منشور → نتائج → دفع → تقييم
//
// لا عقد قبل الاعتماد (حارس 121). والتسليمات محتوىً مربوطٌ بالصفقة،
// والدفع مصروفٌ «مؤثرون» عليها — فتُحسب كلفة الليد والبيعة والعائد
// لكل مؤثر من رابطه الخاص لا من «حسّنا».
// ============================================================
export default async function InfluencersPage() {
  await requireMktRead();
  const supabase = await createClient();
  const f = parseMktFilters({ range: "all" }, baghdadDate());
  const [write, manager, campaigns, channels, vendors, perf, { data: influencers }, { data: deals }, { data: approvals }] = await Promise.all([
    canWriteMarketing(), isMarketingManager(), getCampaignsLite(), getChannels(), getMarketingVendors(), getBreakdown("influencer", f),
    supabase.from("mkt_influencers").select("*").order("name"),
    supabase.from("mkt_influencer_deals").select("*, mkt_influencers(name, username)").order("created_at", { ascending: false }),
    supabase.from("mkt_approvals").select("id, entity_id, approver").eq("entity_type", "مؤثر").eq("status", "معلّق"),
  ]);
  const admin = await isAdmin();
  const camp = new Map(campaigns.map((c) => [c.id, c.name]));
  const ch = new Map(channels.map((c) => [c.id, c.name]));
  const perfBy = new Map(perf.data.map((p) => [p.dim_key, p]));
  const pendingBy = new Map((approvals ?? []).map((a) => [a.entity_id, a as { id: string; approver: string }]));

  return (
    <>
      <PageHead title="المؤثرون" sub="الاختيار بالأرقام: متابعون ومشاهدات وتفاعل قبل التعاقد، وليدات وبيعات وعائد بعده — من روابط التتبّع الخاصّة بكل مؤثر." />

      <Card title="الصفقات">
        {write && <div className="mb-4"><RecordForm table="mkt_influencer_deals" openLabel="صفقة جديدة" initial={{ stage: "بحث", deliverables_count: "1" }}
          fields={[
            { name: "influencer_id", label: "المؤثر", type: "select", required: true, options: (influencers ?? []).map((i) => ({ value: i.id, label: i.name })) },
            { name: "campaign_id", label: "الحملة", type: "select", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
            { name: "stage", label: "المرحلة", type: "select", options: DEAL_STAGES.slice(0, 4), required: true },
            { name: "quoted_rate", label: "السعر المعروض", type: "number" },
            { name: "negotiated_rate", label: "السعر المتفق", type: "number" },
            { name: "deliverables_count", label: "عدد التسليمات", type: "number" },
            { name: "due_date", label: "موعد التسليم", type: "date" },
            { name: "deliverables", label: "التسليمات", type: "textarea", span: 3, placeholder: "ريلز ٣٠ث + ٣ ستوري برابط التتبّع" },
          ]} /></div>}
        <SimpleTable empty="لا صفقات بعد."
          head={["المؤثر", "الحملة", "المرحلة", "السعر", "التسليم", "الكلفة الفعلية", "ليدات", "بيع", "عمولة", "CPL", "ROI", ""]}
          rows={(deals ?? []).map((d) => {
            const inf = d.mkt_influencers as unknown as { name: string; username: string | null } | null;
            const p = perfBy.get(d.id);
            const pending = pendingBy.get(d.id);
            return [
              <span key="n">{inf?.name ?? "—"}{inf?.username && <span className="block text-xs text-gray-400" dir="ltr">@{inf.username}</span>}</span>,
              d.campaign_id ? <Link key="c" href={`/dashboard/marketing/campaigns/${d.campaign_id}`} className="text-xs hover:text-brand-600">{camp.get(d.campaign_id)}</Link> : "—",
              write && !pending ? <FieldSelect key="s" table="mkt_influencer_deals" id={d.id} column="stage" value={d.stage} options={DEAL_STAGES} /> : <Badge key="s">{d.stage}</Badge>,
              fmt(d.negotiated_rate ?? d.quoted_rate),
              <span key="d" dir="ltr" className="text-xs">{d.due_date ?? "—"}</span>,
              fmt(p?.cost), fmt(p?.leads), fmt(p?.sales), fmt(p?.commission), fmt(p?.cpl),
              <span key="r" className={p?.roi == null ? "text-gray-400" : Number(p.roi) >= 0 ? "text-brand-700" : "text-red-600"}>{fmtPct(p?.roi)}</span>,
              <span key="x" className="flex flex-col gap-1">
                {write && !pending && !d.approved_at && ["تفاوض", "تواصل", "قائمة مختصرة"].includes(d.stage) && (
                  <RpcButton small fn="mkt_request_approval" args={{ p_type: "مؤثر", p_id: d.id }} label="اطلب الاعتماد" />
                )}
                {pending && canDecideApproval(pending, { admin, manager }) && (
                  <>
                    <RpcButton small fn="mkt_decide_approval" args={{ p_id: pending.id, p_approve: true }} label="اعتمد" />
                    <RpcButton small tone="danger" fn="mkt_decide_approval" args={{ p_id: pending.id, p_approve: false }} label="ارفض"
                      prompt="سبب الرفض — يصل إلى من طلب" promptKey="p_reason" promptRequired />
                  </>
                )}
                {pending && !canDecideApproval(pending, { admin, manager }) && <span className="text-xs text-amber-700">بانتظار اعتماد {pending.approver}</span>}
                <Link href={`/dashboard/marketing/tracking?deal=${d.id}${d.campaign_id ? `&campaign=${d.campaign_id}` : ""}`} className="text-xs text-brand-600">رابط تتبّع</Link>
                {write && <MetricEntry entityType="مؤثر" entityId={d.id} social />}
              </span>,
            ];
          })} />
        <p className="mt-2 text-xs text-gray-500">الكلفة الفعلية = المدفوع على الصفقة (مصروف «مؤثرون» مربوط بها). والليدات = من دخلوا عبر رابط المؤثر أو سُجّلت لمستهم «مؤثر».</p>
      </Card>

      <Card title="قاعدة المؤثرين">
        {write && <div className="mb-4"><RecordForm table="mkt_influencers" openLabel="مؤثر جديد"
          fields={[
            { name: "name", label: "الاسم", required: true },
            { name: "channel_id", label: "المنصّة", type: "select", options: channels.filter((c) => c.mode === "رقمي").map((c) => ({ value: c.id, label: c.name })) },
            { name: "username", label: "المعرّف @", ltr: true },
            { name: "category", label: "التصنيف", placeholder: "عقارات / لايف ستايل / عائلة" },
            { name: "followers", label: "المتابعون", type: "number" },
            { name: "avg_views", label: "متوسط المشاهدات", type: "number" },
            { name: "engagement_rate", label: "نسبة التفاعل ٪", type: "number" },
            { name: "location", label: "المدينة" },
            { name: "audience", label: "جمهوره", span: 2 },
            { name: "base_rate", label: "سعره المعتاد", type: "number" },
            { name: "phone", label: "الهاتف", ltr: true },
            { name: "manager_name", label: "مديره" },
            { name: "manager_phone", label: "هاتف المدير", ltr: true },
            { name: "vendor_id", label: "يُدفع له كمورّد", type: "select", options: vendors.map((v) => ({ value: v.id, label: v.name })) },
            { name: "rating", label: "التقييم ١–٥", type: "number" },
            { name: "demographics", label: "الديموغرافيا", type: "textarea", span: 3 },
          ]} /></div>}
        <SimpleTable empty="لا مؤثرون."
          head={["المؤثر", "المنصّة", "التصنيف", "المتابعون", "المشاهدات", "التفاعل", "السعر", "التقييم"]}
          rows={(influencers ?? []).map((i) => [
            <span key="n" className={i.is_active ? "" : "text-gray-400"}>{i.name}{i.username && <span className="block text-xs text-gray-400" dir="ltr">@{i.username}</span>}</span>,
            ch.get(i.channel_id ?? "") ?? "—", i.category ?? "—", fmt(i.followers), fmt(i.avg_views), fmtPct(i.engagement_rate), fmt(i.base_rate),
            i.rating ? "★".repeat(i.rating) : "—",
          ])} />
      </Card>
    </>
  );
}
