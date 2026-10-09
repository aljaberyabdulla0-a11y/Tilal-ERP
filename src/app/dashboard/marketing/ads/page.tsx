import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { parseMktFilters } from "@/lib/marketing-filters";
import { getAudiences, getCampaignsLite, getChannels } from "@/lib/marketing";
import { AD_LEVELS, AD_STATUSES, fmt, fmtPct } from "@/lib/marketing-style";
import { Badge, Card, MktFilterBar, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";
import { FieldSelect } from "@/components/marketing/actions";
import MetricEntry from "@/components/marketing/metric-entry";
import ImportMetrics from "./import-metrics";
import AdCampaignSelect from "./ad-campaign-select";

// ============================================================
// الإعلانات المدفوعة — المنصّة ← حساب الإعلانات ← الحملة الإعلانية ←
// المجموعة ← الإعلان ← الإبداع (محتوى من المكتبة).
//
// الأرقام من ثلاثة أبواب إلى جدولٍ واحد (mkt_metrics_daily): المزامنة
// (Meta)، واستيراد CSV، والإدخال اليدوي. و«مصروف المنصّة» هنا ليس
// كلفة التسويق — الكلفة من المصروفات المدفوعة (الدفتر). الفرق بينهما
// يظهر في التحليل «فرقَ مطابقة».
// ============================================================
type Perf = {
  id: string; level: string; parent_id: string | null; name: string; external_id: string | null; status: string;
  campaign_id: string | null; account_id: string; spend: number; impressions: number; reach: number; clicks: number;
  platform_leads: number; real_leads: number; ctr: number | null; cpc: number | null; cpl: number | null;
};

export default async function AdsPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const f = parseMktFilters(searchParams, baghdadDate(), "last30");
  const supabase = await createClient();
  const [write, campaigns, channels, audiences, { data: accounts }, { data: perf, error }, { data: creatives }] = await Promise.all([
    canWriteMarketing(), getCampaignsLite(), getChannels(), getAudiences(),
    supabase.from("mkt_accounts").select("id, name, channel_id, external_id").eq("kind", "حساب إعلانات").order("name"),
    supabase.rpc("mkt_ad_performance", { p_from: f.from, p_to: f.to, p_campaign: f.campaign }),
    supabase.from("mkt_content").select("id, title").in("status", ["معتمد", "مجدول", "منشور"]).order("created_at", { ascending: false }).limit(200),
  ]);
  const rows = (perf ?? []) as Perf[];
  const byParent = new Map<string | null, Perf[]>();
  for (const r of rows) byParent.set(r.parent_id, [...(byParent.get(r.parent_id) ?? []), r]);
  const ordered: { r: Perf; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const r of byParent.get(parent) ?? []) { ordered.push({ r, depth }); walk(r.id, depth + 1); }
  };
  walk(null, 0);
  const acc = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const camp = new Map(campaigns.map((c) => [c.id, c.name]));
  const parents = rows.filter((r) => r.level !== "إعلان");

  return (
    <>
      <PageHead title="الإعلانات المدفوعة" sub="ميتا وجوجل وتيك توك وسناب ولينكدإن ويوتيوب — بتسلسلها، وكلفة الليد على ليدات فعلية دخلت الـCRM لا على ما تدّعيه المنصّة."
        actions={<Link href="/dashboard/marketing/content?tab=accounts" className="rounded-lg border px-3 py-2 text-sm">حسابات الإعلانات</Link>} />
      <MktFilterBar basePath="/dashboard/marketing/ads" f={f} />

      {(accounts ?? []).length === 0 && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
          لا حساب إعلانات بعد. أضِفه من <Link href="/dashboard/marketing/content?tab=accounts" className="underline">الحسابات</Link> بنوع «حساب إعلانات» ومعرّفه عند المنصّة (act_…)، ثم اربطه بتكامل في <Link href="/dashboard/marketing/integrations" className="underline">التكاملات</Link>.
        </p>
      )}

      {write && (accounts ?? []).length > 0 && (
        <RecordForm table="mkt_ad_objects" openLabel="حملة / مجموعة / إعلان" title="عنصر إعلاني جديد" initial={{ level: "حملة إعلانية", status: "مسودة" }}
          fields={[
            { name: "name", label: "الاسم", required: true, span: 2 },
            { name: "level", label: "المستوى", type: "select", options: AD_LEVELS, required: true },
            { name: "account_id", label: "حساب الإعلانات", type: "select", required: true, options: (accounts ?? []).map((a) => ({ value: a.id, label: a.name })) },
            { name: "parent_id", label: "تحت (للمجموعة والإعلان)", type: "select", options: parents.map((p) => ({ value: p.id, label: `${p.level}: ${p.name}` })) },
            { name: "campaign_id", label: "حملة تلال", type: "select", options: campaigns.map((c) => ({ value: c.id, label: c.name })), hint: "يرثها ما تحته" },
            { name: "external_id", label: "المعرّف عند المنصّة", ltr: true },
            { name: "objective", label: "الهدف" },
            { name: "audience_id", label: "الجمهور", type: "select", options: audiences.map((a) => ({ value: a.id, label: a.name })) },
            { name: "placement", label: "المواضع", placeholder: "Reels · Feed · Stories" },
            { name: "content_id", label: "الإبداع (محتوى معتمد)", type: "select", options: (creatives ?? []).map((c) => ({ value: c.id, label: c.title })) },
            { name: "daily_budget", label: "ميزانية يومية", type: "number" },
            { name: "lifetime_budget", label: "ميزانية إجمالية", type: "number" },
            { name: "start_date", label: "من", type: "date" },
            { name: "end_date", label: "إلى", type: "date" },
          ]} />
      )}

      <Card title="الأداء في المدة" actions={<span className="text-xs text-gray-400">{channels.length} قناة · CTR = نقر ÷ ظهور · CPL على الليدات الفعلية</span>}>
        {error && <p className="text-sm text-red-700">{error.message}</p>}
        <SimpleTable empty="لا عناصر إعلانية."
          head={["العنصر", "الحساب / الحملة", "الحالة", "مصروف المنصّة", "ظهور", "نقر", "CTR", "CPC", "ليدات المنصّة", "ليدات فعلية", "CPL", ""]}
          rows={ordered.map(({ r, depth }) => [
            <span key="n" style={{ paddingInlineStart: depth * 16 }} className="block">
              <span className="text-xs text-gray-400">{r.level} · </span><b className="font-medium">{r.name}</b>
              {r.external_id && <span className="block text-xs text-gray-400" dir="ltr">{r.external_id}</span>}
            </span>,
            <span key="a" className="text-xs">{acc.get(r.account_id) ?? "—"}
              {write && r.level === "حملة إعلانية"
                ? <span className="mt-0.5 block"><AdCampaignSelect id={r.id} value={r.campaign_id} campaigns={campaigns} /></span>
                : <span className="block text-brand-700">{camp.get(r.campaign_id ?? "") ?? "بلا حملة"}</span>}
            </span>,
            write ? <FieldSelect key="s" table="mkt_ad_objects" id={r.id} column="status" value={r.status} options={AD_STATUSES} /> : <Badge key="s">{r.status}</Badge>,
            fmt(r.spend), fmt(r.impressions), fmt(r.clicks), fmtPct(r.ctr), fmt(r.cpc), fmt(r.platform_leads),
            <b key="l" className="text-brand-700">{fmt(r.real_leads)}</b>, fmt(r.cpl),
            write && r.level === "إعلان" ? <MetricEntry key="m" entityType="إعلان" entityId={r.id} /> : null,
          ])} />
      </Card>

      {write && (
        <Card title="استيراد مقاييس من ملف">
          <ImportMetrics />
        </Card>
      )}
    </>
  );
}
