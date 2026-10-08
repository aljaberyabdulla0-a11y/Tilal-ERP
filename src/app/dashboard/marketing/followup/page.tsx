import Link from "next/link";
import { requireMktMoney } from "@/lib/marketing-guard";
import { baghdadDate } from "@/lib/time";
import { parseMktFilters } from "@/lib/marketing-filters";
import { getLeadFollowup } from "@/lib/marketing";
import { fmt, fmtPct } from "@/lib/marketing-style";
import { Card, MktFilterBar, PageHead, Tile, Unavailable } from "@/components/marketing/ui";
import FollowupTable from "@/components/marketing/followup-table";

// ============================================================
// Following up marketing leads — has the paid-for lead reached anyone in sales?
//
// The marketing expense is lost after the lead arrives if nobody calls it: here per responsible
// employee (mkt_lead_followup — 195). Staff names, not clients (092), and the lead = a marketing
// lead (campaign, touchpoint, or a source linked to a channel) — not a broker office or acquaintances.
// ============================================================
export default async function FollowupPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktMoney();
  const f = parseMktFilters(searchParams, baghdadDate(), "last30");
  const { data, error } = await getLeadFollowup(f.from, f.to, f.campaign);
  const sum = (k: "leads" | "contacted" | "stale" | "reserved" | "sold") => data.reduce((a, r) => a + Number(r[k]), 0);
  const leads = sum("leads");
  const unowned = data.find((r) => !r.employee_id);

  return (
    <>
      <PageHead title="متابعة ليدات التسويق"
        sub="هل وصل الليد المدفوع ثمنه إلى أحدٍ في المبيعات؟ «متروك» = مفتوح بلا اتصال بعد يومين من دخوله." />
      <MktFilterBar basePath="/dashboard/marketing/followup" f={f} />
      <Unavailable error={error} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="ليدات تسويقية" value={fmt(leads)} />
        <Tile label="تمّ التواصل" value={fmt(sum("contacted"))} sub={leads ? fmtPct((sum("contacted") * 100) / leads) : undefined} tone="brand" />
        <Tile label="متروك بلا اتصال" value={fmt(sum("stale"))} tone={sum("stale") ? "bad" : undefined} />
        <Tile label="بلا مسؤول" value={fmt(unowned?.leads ?? 0)} tone={unowned?.leads ? "warn" : undefined} href="/dashboard/crm/distribution" />
        <Tile label="حجز / بيع" value={`${fmt(sum("reserved"))} / ${fmt(sum("sold"))}`} />
      </section>

      <Card title="بالموظف">
        <FollowupTable rows={data} />
        <p className="mt-2 text-xs text-gray-500">
          إعادة توزيع المتروك والمعلّق بلا مسؤول من <Link href="/dashboard/crm/distribution" className="text-brand-600 hover:underline">شاشة التوزيع</Link>.
        </p>
      </Card>
    </>
  );
}
