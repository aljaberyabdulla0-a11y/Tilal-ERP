import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing } from "@/lib/auth";
import { getChannels, getMktProjects, getPeople, getAudiences, peopleMap } from "@/lib/marketing";
import { PLAN_KINDS, fmt } from "@/lib/marketing-style";
import { Badge, Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";

// ============================================================
// الاستراتيجية والخطط — والجمهور والمنافسون.
//
// الاستراتيجية خطةٌ من نوعها، والخطط تحتها (parent_id). وكل هدفٍ له
// مقياسٌ من قائمة مغلقة فيُحسب «فعليّه» من القاعدة — هدفٌ يُكتب فعليّه
// باليد يصير ما يتمنّاه كاتبه.
// ============================================================
const TABS = [["plans", "الخطط والاستراتيجيات"], ["audiences", "الجمهور"], ["competitors", "المنافسون"]] as const;

export default async function PlansPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const tab = TABS.find(([k]) => k === searchParams.tab)?.[0] ?? "plans";
  const supabase = await createClient();
  const [write, people, projects, channels, audiences] = await Promise.all([
    canWriteMarketing(), getPeople(), getMktProjects(), getChannels(), getAudiences(),
  ]);

  return (
    <>
      <PageHead title="الاستراتيجية والخطط" sub="سنوية وربعية وشهرية وأسبوعية، وخطط الحملة والمشروع والقناة — بأهدافٍ تُقاس من القاعدة." />
      <nav className="flex gap-1 border-b border-gray-200">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/dashboard/marketing/plans?tab=${k}`}
            className={tab === k ? "-mb-px border-b-2 border-brand-600 px-3 py-2 text-sm font-semibold text-brand-600" : "px-3 py-2 text-sm text-gray-500 hover:text-brand-600"}>{l}</Link>
        ))}
      </nav>

      {tab === "plans" && <PlansTab write={write} people={people} projects={projects} channels={channels} audiences={audiences} supabase={supabase} />}

      {tab === "audiences" && (
        <>
          {write && <RecordForm table="mkt_audiences" openLabel="جمهور جديد" fields={[
            { name: "name", label: "الاسم", required: true, span: 2, placeholder: "مستثمرون من بغداد ٣٥–٥٥" },
            { name: "segment", label: "الشريحة", placeholder: "مستثمر / سكن أول / مغترب" },
            { name: "age_range", label: "العمر", placeholder: "35-55" },
            { name: "locations", label: "المناطق" },
            { name: "income_level", label: "الدخل" },
            { name: "interests", label: "الاهتمامات", span: 2 },
            { name: "project_id", label: "المشروع", type: "select", options: projects.map((p) => ({ value: p.id, label: p.name })) },
            { name: "description", label: "الوصف", type: "textarea", span: 3 },
          ]} />}
          <Card>
            <SimpleTable empty="لا شرائح جمهور بعد." head={["الجمهور", "الشريحة", "الوصف", "المشروع"]}
              rows={audiences.map((a) => [a.name, a.segment ?? "—", a.description ?? "—", projects.find((p) => p.id === a.project_id)?.name ?? "—"])} />
          </Card>
        </>
      )}

      {tab === "competitors" && <CompetitorsTab write={write} supabase={supabase} />}
    </>
  );
}

async function PlansTab({ write, people, projects, channels, audiences, supabase }: {
  write: boolean; people: Awaited<ReturnType<typeof getPeople>>; projects: Awaited<ReturnType<typeof getMktProjects>>;
  channels: Awaited<ReturnType<typeof getChannels>>; audiences: Awaited<ReturnType<typeof getAudiences>>;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const { data } = await supabase.from("mkt_plans").select("*").order("period_start", { ascending: false });
  const plans = data ?? [];
  const names = peopleMap(people);
  const title = new Map(plans.map((p) => [p.id, p.title]));
  return (
    <>
      {write && (
        <RecordForm table="mkt_plans" openLabel="خطة جديدة" title="خطة أو استراتيجية جديدة" onSavedRedirectWithId="/dashboard/marketing/plans/"
          fields={[
            { name: "title", label: "العنوان", required: true, span: 2, placeholder: "استراتيجية ٢٠٢٧ — نموّ الليدات المؤهَّلة" },
            { name: "kind", label: "النوع", type: "select", options: PLAN_KINDS, required: true },
            { name: "period_start", label: "من", type: "date", required: true },
            { name: "period_end", label: "إلى", type: "date", required: true },
            { name: "parent_id", label: "تحت خطة", type: "select", options: plans.map((p) => ({ value: p.id, label: p.title })) },
            { name: "project_id", label: "المشروع", type: "select", options: projects.map((p) => ({ value: p.id, label: p.name })) },
            { name: "channel_id", label: "القناة", type: "select", options: channels.map((c) => ({ value: c.id, label: c.name })) },
            { name: "audience_id", label: "الجمهور", type: "select", options: audiences.map((a) => ({ value: a.id, label: a.name })) },
            { name: "owner_employee_id", label: "المسؤول", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
            { name: "budget", label: "الميزانية", type: "number" },
            { name: "expected_leads", label: "ليدات متوقعة", type: "number" },
            { name: "expected_sales", label: "بيعات متوقعة", type: "number" },
            { name: "expected_revenue", label: "عمولة متوقعة", type: "number" },
            { name: "positioning", label: "التموضع", type: "textarea", span: 3 },
            { name: "value_proposition", label: "عرض القيمة", type: "textarea", span: 3 },
            { name: "hypotheses", label: "الفرضيات", type: "textarea", span: 3, placeholder: "إعلانات الفيديو القصير على تيك توك تجيب ليدات أرخص من فيسبوك للشريحة ٢٥–٣٥" },
          ]} />
      )}
      <Card>
        <SimpleTable empty="لا خطط بعد."
          head={["الخطة", "النوع", "الفترة", "تحت", "المسؤول", "الميزانية", "الحالة"]}
          rows={plans.map((p) => [
            <Link key="t" href={`/dashboard/marketing/plans/${p.id}`} className="font-medium hover:text-brand-600">{p.title}</Link>,
            p.kind, <span key="d" dir="ltr" className="text-xs">{p.period_start} → {p.period_end}</span>,
            title.get(p.parent_id ?? "") ?? "—", names.get(p.owner_employee_id ?? "") ?? "—", fmt(p.budget), <Badge key="s">{p.status}</Badge>,
          ])} />
      </Card>
    </>
  );
}

async function CompetitorsTab({ write, supabase }: { write: boolean; supabase: Awaited<ReturnType<typeof createClient>> }) {
  const { data } = await supabase.from("mkt_competitors").select("*").order("name");
  return (
    <>
      {write && <RecordForm table="mkt_competitors" openLabel="منافس" fields={[
        { name: "name", label: "المنافس", required: true, span: 2 },
        { name: "price_position", label: "موقع السعر", placeholder: "أعلى / مماثل / أدنى" },
        { name: "projects", label: "مشاريعه", span: 3 },
        { name: "strengths", label: "قوّته", type: "textarea" },
        { name: "weaknesses", label: "ضعفه", type: "textarea" },
        { name: "notes", label: "ملاحظات", type: "textarea" },
      ]} />}
      <Card>
        <SimpleTable empty="لا منافسون مسجّلون." head={["المنافس", "مشاريعه", "السعر", "قوّته", "ضعفه"]}
          rows={(data ?? []).map((c) => [c.name, c.projects ?? "—", c.price_position ?? "—", c.strengths ?? "—", c.weaknesses ?? "—"])} />
      </Card>
    </>
  );
}
