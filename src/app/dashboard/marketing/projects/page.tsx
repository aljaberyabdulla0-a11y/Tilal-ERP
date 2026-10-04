import Link from "next/link";
import { requireMktRead } from "@/lib/marketing-guard";
import { baghdadDate } from "@/lib/time";
import { parseMktFilters } from "@/lib/marketing-filters";
import { getBreakdown, getMktProjects } from "@/lib/marketing";
import { fmt, fmtPct } from "@/lib/marketing-style";
import { Card, MktFilterBar, PageHead, Unavailable } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";

// تسويق المشاريع — كل مشروعٍ بكلفته وليداته وبيعاته وعمولته. وأيّها يحتاج تسويقاً أكثر.
export default async function ProjectsMarketing({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const f = parseMktFilters(searchParams, baghdadDate(), "year");
  const [projects, perf] = await Promise.all([getMktProjects(), getBreakdown("project", f)]);
  const by = new Map(perf.data.map((p) => [p.dim_key, p]));

  return (
    <>
      <PageHead title="تسويق المشاريع" sub="لكل مشروع مساحة تسويقه: مخزونه المتاح، وكلفة تسويقه، وما جلبته من ليدات وبيعات وعمولة تلال." />
      <MktFilterBar basePath="/dashboard/marketing/projects" f={f} showModel showCampaign={false} />
      <Unavailable error={perf.error} />
      <Card>
        <SimpleTable empty="لا مشاريع."
          head={["المشروع", "الكلفة", "ليدات", "مؤهَّل", "حجز", "بيع", "قيمة البيع", "عمولة تلال", "CPL", "CAC", "ROI"]}
          rows={projects.map((p) => {
            const r = by.get(p.id);
            return [
              <Link key="n" href={`/dashboard/marketing/projects/${p.id}`} className="font-medium hover:text-brand-600">{p.name}<span className="block text-xs text-gray-400">{p.governorate ?? ""}</span></Link>,
              fmt(r?.cost ?? 0), fmt(r?.leads ?? 0), fmt(r?.qualified ?? 0), fmt(r?.reservations ?? 0),
              <b key="s" className="text-brand-700">{fmt(r?.sales ?? 0)}</b>, fmt(r?.sale_value ?? 0), fmt(r?.commission ?? 0),
              fmt(r?.cpl), fmt(r?.cac), <span key="roi" className={r?.roi == null ? "text-gray-400" : Number(r.roi) >= 0 ? "text-brand-700" : "text-red-600"}>{fmtPct(r?.roi)}</span>,
            ];
          })} />
        {perf.data.some((p) => p.dim_key === null) && <p className="mt-2 text-xs text-gray-500">«غير منسوب»: كلفة أو ليدات بلا مشروع — حملات العلامة التجارية مثلاً.</p>}
      </Card>
    </>
  );
}
