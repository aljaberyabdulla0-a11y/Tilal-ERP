import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { baghdadDate } from "@/lib/time";
import { parseMktFilters } from "@/lib/marketing-filters";
import { getBreakdown, getFunnel, getProjectOverview, getUnits, type Kpis } from "@/lib/marketing";
import { fmt, fmtPct } from "@/lib/marketing-style";
import { Badge, Card, MktFilterBar, PageHead, Tile, Unavailable } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import { FunnelBars, HBars } from "@/components/marketing/charts";

// ============================================================
// مساحة تسويق المشروع — المخزون العقاري قراءةً (لا يمسّه التسويق)،
// والتسويق حوله: حملاته ومحتواه وأنشطته وقنواته وعائده.
//
// والعائد على عمولة تلال لا على قيمة الوحدات — قيمة المبيعات تُعرض
// منفصلةً باسمها (§60).
// ============================================================
type Overview = {
  project: { id: string; name: string; governorate: string | null; area: string | null; status: string | null };
  units: { total: number; available: number; sold: number; blocked: number; reserved: number; min_price: number | null; max_price: number | null };
  kpis: Kpis; campaigns: number; content: number; activities: number; influencer_deals: number;
};

export default async function ProjectMarketing({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string> }) {
  await requireMktRead();
  const f = { ...parseMktFilters(searchParams, baghdadDate(), "year"), project: params.id };
  const [ov, byChannel, byCampaign, funnel, units] = await Promise.all([
    getProjectOverview(params.id, f.from, f.to), getBreakdown("channel", f), getBreakdown("campaign", f), getFunnel(f), getUnits(params.id),
  ]);
  if (!ov.data && !ov.error) notFound();
  const o = ov.data as unknown as Overview | null;
  const supabase = await createClient();
  const [{ data: campaigns }, { data: content }, { data: activities }] = await Promise.all([
    supabase.from("crm_campaigns").select("id, name, status, budget, spent, start_date, end_date").eq("project_id", params.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("mkt_content").select("id, title, content_type, status, publish_at").eq("project_id", params.id).neq("status", "مؤرشف").order("created_at", { ascending: false }).limit(20),
    supabase.from("mkt_activities").select("id, title, kind, status, start_date, end_date").eq("project_id", params.id).order("start_date", { ascending: false, nullsFirst: false }).limit(20),
  ]);
  const types = new Map<string, number>();
  for (const u of units) if (u.status === "متاحة") types.set(u.unit_type ?? "—", (types.get(u.unit_type ?? "—") ?? 0) + 1);
  const k = o?.kpis;

  return (
    <>
      <PageHead title={`تسويق ${o?.project.name ?? "المشروع"}`} sub={[o?.project.governorate, o?.project.area].filter(Boolean).join(" — ")}
        actions={<Link href={`/dashboard/marketing/campaigns/new`} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white">حملة للمشروع</Link>} />
      <MktFilterBar basePath={`/dashboard/marketing/projects/${params.id}`} f={f} showModel showCampaign={false} />
      <Unavailable error={ov.error} />

      {o && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="الوحدات" value={fmt(o.units.total)} sub={`مباعة ${fmt(o.units.sold)} · موقوفة ${fmt(o.units.blocked)}`} />
          <Tile label="متاحة" value={fmt(o.units.available)} tone="brand" sub={`محجوزة منها ${fmt(o.units.reserved)}`} />
          <Tile label="نطاق السعر المتاح" value={o.units.min_price ? `${fmt(o.units.min_price)}` : "—"} sub={o.units.max_price ? `حتى ${fmt(o.units.max_price)}` : undefined} />
          <Tile label="حملات جارية" value={fmt(o.campaigns)} sub={`محتوى ${fmt(o.content)} · ميداني ${fmt(o.activities)} · مؤثرون ${fmt(o.influencer_deals)}`} />
          <Tile label="نسبة البيع" value={fmtPct(o.units.total ? (o.units.sold * 100) / o.units.total : null)} />
        </section>
      )}
      {k && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Tile label="كلفة التسويق" value={fmt(k.cost)} />
          <Tile label="ليدات" value={fmt(k.leads)} sub={`مؤهَّلون ${fmt(k.qualified)}`} />
          <Tile label="بيعات منسوبة" value={fmt(k.sales)} tone="brand" sub={`قيمة ${fmt(k.sale_value)}`} />
          <Tile label="عمولة تلال" value={fmt(k.commission)} tone="brand" />
          <Tile label="CPL / CAC" value={fmt(k.cpl)} sub={`CAC ${fmt(k.cac)}`} />
          <Tile label="ROI" value={fmtPct(k.roi)} tone={k.roi == null ? undefined : k.roi >= 0 ? "brand" : "bad"} sub={`ROAS ${k.roas == null ? "—" : `${fmt(k.roas)}×`}`} />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="القمع"><FunnelBars steps={funnel.data.filter((s) => s.step >= 5)} /></Card>
        <Card title="الليدات بالقناة"><HBars rows={byChannel.data.map((r) => ({ key: r.dim_key ?? "x", label: r.label, value: Number(r.leads) }))} /></Card>
        <Card title="المتاح بالنوع"><HBars rows={Array.from(types.entries()).map(([t, n]) => ({ key: t, label: t, value: n }))} unit="وحدة" empty="لا متاح" /></Card>
      </div>

      <Card title="الحملات">
        <SimpleTable empty="لا حملات على المشروع."
          head={["الحملة", "الحالة", "المدة", "الميزانية", "المصروف", "ليدات", "بيع", "ROI"]}
          rows={(campaigns ?? []).map((c) => {
            const p = byCampaign.data.find((x) => x.dim_key === c.id);
            return [<Link key="n" href={`/dashboard/marketing/campaigns/${c.id}`} className="hover:text-brand-600">{c.name}</Link>, <Badge key="s">{c.status}</Badge>,
              <span key="d" dir="ltr" className="text-xs">{c.start_date ?? "—"} → {c.end_date ?? "—"}</span>, fmt(c.budget), fmt(c.spent), fmt(p?.leads), fmt(p?.sales), fmtPct(p?.roi)];
          })} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="المحتوى">
          <SimpleTable empty="لا محتوى." head={["العنوان", "النوع", "الحالة"]}
            rows={(content ?? []).map((c) => [<Link key="t" href={`/dashboard/marketing/content/${c.id}`} className="hover:text-brand-600">{c.title}</Link>, c.content_type, <Badge key="s">{c.status}</Badge>])} />
        </Card>
        <Card title="الميداني والفعاليات">
          <SimpleTable empty="لا أنشطة." head={["النشاط", "النوع", "المدة", "الحالة"]}
            rows={(activities ?? []).map((a) => [<Link key="t" href={`/dashboard/marketing/offline/${a.id}`} className="hover:text-brand-600">{a.title}</Link>, a.kind,
              <span key="d" dir="ltr" className="text-xs">{a.start_date ?? "—"} → {a.end_date ?? "—"}</span>, <Badge key="s">{a.status}</Badge>])} />
        </Card>
      </div>
    </>
  );
}
