import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canManageFinance, canWriteMarketing, isAdmin, isMarketingManager } from "@/lib/auth";
import { canDecideApproval, getCampaignsLite, getChannels, getEntityApprovals, getMktProjects, getPeople, getAudiences, peopleMap } from "@/lib/marketing";
import { CONTENT_FREE_STATUSES, CONTENT_TYPES, fmt } from "@/lib/marketing-style";
import { Badge, Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";
import { FieldSelect, RpcButton } from "@/components/marketing/actions";
import MetricEntry from "@/components/marketing/metric-entry";

// قطعة المحتوى: النصّ والفريق والاعتماد والنسخ والأصول والأداء.
export default async function ContentItem({ params }: { params: { id: string } }) {
  await requireMktRead();
  const supabase = await createClient();
  const { data: c } = await supabase.from("mkt_content").select("*").eq("id", params.id).maybeSingle();
  if (!c) notFound();

  const [write, manager, people, campaigns, channels, projects, audiences, approvals, { data: versions }, { data: metrics }, { data: assets }, { data: accounts }] = await Promise.all([
    canWriteMarketing(), isMarketingManager(), getPeople(), getCampaignsLite(), getChannels(), getMktProjects(), getAudiences(),
    getEntityApprovals("محتوى", c.id),
    supabase.from("mkt_content_versions").select("*").eq("content_id", c.id).order("version", { ascending: false }),
    supabase.from("mkt_metrics_daily").select("*").eq("entity_type", "محتوى").eq("entity_id", c.id).order("metric_date", { ascending: false }).limit(60),
    supabase.from("mkt_content_assets").select("asset_id, mkt_assets(id, title, asset_type, file_name)").eq("content_id", c.id),
    supabase.from("mkt_accounts").select("id, name").eq("is_active", true).order("name"),
  ]);
  const names = peopleMap(people);
  const pending = approvals.find((a) => a.status === "معلّق");
  const [admin, finance] = await Promise.all([isAdmin(), canManageFinance()]);
  const decide = pending ? canDecideApproval(pending, { admin, manager, finance }) : false;
  const totals = (metrics ?? []).reduce((a, m) => ({
    impressions: a.impressions + Number(m.impressions), reach: a.reach + Number(m.reach), engagements: a.engagements + Number(m.engagements),
    likes: a.likes + Number(m.likes), comments: a.comments + Number(m.comments), shares: a.shares + Number(m.shares),
    saves: a.saves + Number(m.saves), video_views: a.video_views + Number(m.video_views), link_clicks: a.link_clicks + Number(m.link_clicks),
    followers: a.followers + Number(m.followers_gained), leads: a.leads + Number(m.leads),
  }), { impressions: 0, reach: 0, engagements: 0, likes: 0, comments: 0, shares: 0, saves: 0, video_views: 0, link_clicks: 0, followers: 0, leads: 0 });
  const { count: realLeads } = await supabase.from("mkt_touchpoints").select("id", { count: "exact", head: true }).eq("content_id", c.id);
  const copilotQ = encodeURIComponent(`اكتب ${c.content_type} بعنوان «${c.title}»${c.brief ? ` — الموجز: ${c.brief}` : ""}. أعطني ٣ صيغ للنصّ، ونداء إجراء، وهاشتاغات.`);

  return (
    <>
      <PageHead title={c.title}
        sub={`${c.code} · ${c.content_type} · النسخة ${c.version}${c.campaign_id ? ` · ${campaigns.find((x) => x.id === c.campaign_id)?.name ?? ""}` : ""}`}
        actions={<>
          <Badge>{c.status}</Badge>
          {write && !pending && <FieldSelect table="mkt_content" id={c.id} column="status" value={c.status}
            options={[...CONTENT_FREE_STATUSES, ...(c.approved_at || manager ? ["مجدول", "منشور"] : [])]} small={false} />}
          {write && !pending && !["معتمد", "مجدول", "منشور"].includes(c.status) && (
            <RpcButton fn="mkt_request_approval" args={{ p_type: "محتوى", p_id: c.id }} label="اطلب الاعتماد" icon="approval" />
          )}
          {decide && pending && <RpcButton fn="mkt_decide_approval" args={{ p_id: pending.id, p_approve: true }} label="اعتمد" icon="check" />}
          {decide && pending && <RpcButton fn="mkt_decide_approval" args={{ p_id: pending.id, p_approve: false }} label="ارفض" tone="danger"
            prompt="سبب الرفض" promptKey="p_reason" promptRequired />}
          <Link href={`/dashboard/marketing/copilot?q=${copilotQ}`} className="rounded-lg border px-3 py-1.5 text-sm">✨ اقترح نصّاً</Link>
        </>} />

      {c.status === "مرفوض" && approvals.find((a) => a.status === "مرفوض")?.reason && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-700">سبب الرفض: {approvals.find((a) => a.status === "مرفوض")?.reason}</p>
      )}
      {pending && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">بانتظار اعتماد {pending.approver} — طلبه {pending.requested_by_name}.</p>}

      {write ? (
        <RecordForm table="mkt_content" id={c.id} initial={c} submitLabel="احفظ"
          fields={[
            { name: "title", label: "العنوان", required: true, span: 2 },
            { name: "content_type", label: "النوع", type: "select", options: CONTENT_TYPES, required: true },
            { name: "objective", label: "الهدف", span: 2 },
            { name: "format", label: "الصيغة", placeholder: "9:16 · 30 ث" },
            { name: "brief", label: "الموجز", type: "textarea", span: 3 },
            { name: "script", label: "السيناريو", type: "textarea", span: 3 },
            { name: "caption", label: "النصّ المنشور", type: "textarea", span: 3 },
            { name: "cta", label: "نداء الإجراء", span: 2 },
            { name: "hashtags", label: "الهاشتاغات", ltr: true },
            { name: "campaign_id", label: "الحملة", type: "select", options: campaigns.map((x) => ({ value: x.id, label: x.name })) },
            { name: "project_id", label: "المشروع", type: "select", options: projects.map((x) => ({ value: x.id, label: x.name })) },
            { name: "channel_id", label: "القناة", type: "select", options: channels.map((x) => ({ value: x.id, label: x.name })) },
            { name: "account_id", label: "الحساب", type: "select", options: (accounts ?? []).map((x) => ({ value: x.id, label: x.name })) },
            { name: "audience_id", label: "الجمهور", type: "select", options: audiences.map((x) => ({ value: x.id, label: x.name })) },
            { name: "owner_id", label: "المسؤول", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
            { name: "writer_id", label: "الكاتب", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
            { name: "designer_id", label: "المصمّم", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
            { name: "photographer_id", label: "المصوّر", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
            { name: "editor_id", label: "المونتير", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
            { name: "reviewer_id", label: "المراجع", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
            { name: "due_date", label: "موعد التسليم", type: "date" },
            { name: "publish_at", label: "موعد النشر", type: "datetime" },
            { name: "published_url", label: "رابط المنشور", ltr: true, span: 2 },
          ]} />
      ) : (
        <Card title="النصّ">
          <p className="whitespace-pre-line text-sm">{c.caption ?? c.brief ?? "—"}</p>
          <p className="mt-2 text-xs text-gray-500">المسؤول: {names.get(c.owner_id ?? "") ?? "—"}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="الأداء" actions={<span className="text-xs text-gray-500">ليدات منسوبة فعلاً: {fmt(realLeads ?? 0)}</span>}>
          <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
            {([["ظهور", totals.impressions], ["وصول", totals.reach], ["تفاعل", totals.engagements], ["إعجاب", totals.likes], ["تعليق", totals.comments],
              ["مشاركة", totals.shares], ["حفظ", totals.saves], ["مشاهدة", totals.video_views], ["نقر رابط", totals.link_clicks],
              ["متابعون جدد", totals.followers], ["ليدات (المنصّة)", totals.leads]] as [string, number][]).map(([l, v]) => (
              <div key={l} className="rounded bg-gray-50 p-2"><p className="font-semibold tabular-nums">{fmt(v)}</p><p className="text-gray-500">{l}</p></div>
            ))}
          </div>
          {write && <MetricEntry entityType="محتوى" entityId={c.id} social />}
        </Card>
        <Card title="الأصول المرفقة" actions={<Link href={`/dashboard/marketing/assets?content=${c.id}`} className="text-xs text-brand-600">أرفق من المكتبة</Link>}>
          <SimpleTable empty="لا أصول مرفقة." head={["الأصل", "النوع", "الملف"]}
            rows={(assets ?? []).map((a) => {
              const x = a.mkt_assets as unknown as { title: string; asset_type: string; file_name: string } | null;
              return [x?.title ?? "—", x?.asset_type ?? "—", x?.file_name ?? "—"];
            })} />
        </Card>
      </div>

      <Card title="النسخ السابقة">
        <SimpleTable empty="لا نسخ سابقة — النصّ لم يُعدَّل بعد."
          head={["النسخة", "متى", "العنوان", "النصّ"]}
          rows={(versions ?? []).map((v) => [v.version, <span key="d" dir="ltr" className="text-xs">{v.changed_at.slice(0, 16).replace("T", " ")}</span>,
            v.title, <span key="c" className="line-clamp-3 whitespace-pre-line text-xs text-gray-600">{v.caption ?? v.script ?? v.brief ?? "—"}</span>])} />
      </Card>
    </>
  );
}
