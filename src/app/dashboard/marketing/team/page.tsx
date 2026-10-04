import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { isAdmin, isMarketingManager } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { getChannels, getPeople, peopleMap } from "@/lib/marketing";
import { MKT_ROLES, fmt } from "@/lib/marketing-style";
import { Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";
import { FieldSelect, ToggleField } from "@/components/marketing/actions";
// mkt_team مفتاحه employee_id لا id — مكوّنان صغيران بدل التعميم
import TeamRole from "./team-role";
import TeamActive from "./team-active";

// ============================================================
// الفريق والإعدادات.
//
// الفريق من ملفّات الموظفين (HR) — لا سجلّ موظفٍ ثانٍ. الدور الوظيفي
// يفتح القسم لصاحبه بلا تغيير دوره في النظام، و«مدير التسويق» يعتمد.
// والقنوات (وUTM كل قناة) وقواعد الموافقة هنا كذلك.
// ============================================================
export default async function TeamPage() {
  await requireMktRead();
  const supabase = await createClient();
  const [manager, admin, people, channels, { data: team }, { data: rules }, { data: tasks }] = await Promise.all([
    isMarketingManager(), isAdmin(), getPeople(), getChannels(),
    supabase.from("mkt_team").select("*"),
    supabase.from("mkt_approval_rules").select("*").order("entity_type").order("min_amount"),
    supabase.from("mkt_tasks").select("assignee_id, status, due_date").neq("status", "منجزة"),
  ]);
  const names = peopleMap(people);
  const today = baghdadDate();
  const load = new Map<string, { open: number; late: number }>();
  for (const t of tasks ?? []) {
    if (!t.assignee_id) continue;
    const x = load.get(t.assignee_id) ?? { open: 0, late: 0 };
    x.open++; if (t.due_date && t.due_date < today) x.late++;
    load.set(t.assignee_id, x);
  }
  const inTeam = new Set((team ?? []).map((t) => t.employee_id));

  return (
    <>
      <PageHead title="الفريق والإعدادات" sub="أعضاء الفريق من ملفّات الموظفين، والقنوات بـ UTM موحّد، وقواعد من يعتمد ماذا." />

      <Card title="فريق التسويق">
        {manager && <div className="mb-4"><RecordForm table="mkt_team" openLabel="ضمّ موظفاً" returnsId={false}
          fields={[
            { name: "employee_id", label: "الموظف", type: "select", required: true, options: people.filter((p) => !inTeam.has(p.id)).map((p) => ({ value: p.id, label: `${p.full_name}${p.job_title ? ` — ${p.job_title}` : ""}` })) },
            { name: "mkt_role", label: "الدور في التسويق", type: "select", options: MKT_ROLES, required: true },
            { name: "notes", label: "ملاحظات" },
          ]} /></div>}
        <SimpleTable empty="لا أعضاء — المدير يعتمد كل شيء حتى يُعيَّن «مدير التسويق»."
          head={["الموظف", "الدور", "مهامّ مفتوحة", "متأخّرة", "الحالة"]}
          rows={(team ?? []).map((t) => [
            names.get(t.employee_id) ?? "—",
            manager ? <TeamRole key="r" employeeId={t.employee_id} value={t.mkt_role} /> : t.mkt_role,
            fmt(load.get(t.employee_id)?.open ?? 0),
            <span key="l" className={(load.get(t.employee_id)?.late ?? 0) ? "text-red-600" : ""}>{fmt(load.get(t.employee_id)?.late ?? 0)}</span>,
            manager ? <TeamActive key="a" employeeId={t.employee_id} value={t.is_active} /> : (t.is_active ? "فعّال" : "موقوف"),
          ])} />
        <p className="mt-2 text-xs text-gray-500">مسؤول الدخول بدور «تسويق» (marketing) في النظام يدخل القسم أصلاً؛ الفريق لمن دوره «موظف» ويعمل في التسويق.</p>
      </Card>

      <Card title="القنوات">
        {admin && <div className="mb-4"><RecordForm table="mkt_channels" openLabel="قناة جديدة" initial={{ mode: "رقمي", sort_order: "100" }}
          fields={[
            { name: "name", label: "الاسم", required: true },
            { name: "mode", label: "النوع", type: "select", options: ["رقمي", "ميداني"], required: true },
            { name: "utm_source", label: "utm_source", required: true, ltr: true },
            { name: "utm_medium", label: "utm_medium", required: true, ltr: true },
            { name: "platform", label: "المنصّة", ltr: true },
            { name: "monthly_budget", label: "ميزانية شهرية مرجعية", type: "number" },
            { name: "owner_employee_id", label: "المسؤول", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
            { name: "sort_order", label: "الترتيب", type: "number" },
          ]} /></div>}
        <SimpleTable
          head={["القناة", "النوع", "UTM", "المسؤول", "ميزانية مرجعية", "الحالة"]}
          rows={channels.map((c) => [c.name, c.mode, <span key="u" dir="ltr" className="font-mono text-xs">{c.utm_source} / {c.utm_medium}</span>,
            names.get(c.owner_employee_id ?? "") ?? "—", fmt(c.monthly_budget),
            admin ? <ToggleField key="a" table="mkt_channels" id={c.id} column="is_active" value={c.is_active} on="فعّالة" off="موقوفة" /> : (c.is_active ? "فعّالة" : "موقوفة")])} />
        <p className="mt-2 text-xs text-gray-500">utm_source/utm_medium لا يُعدَّلان بعد ورود ليدات — يتغيّر بهما تصنيف التاريخ. أضِف قناة بدلها.</p>
      </Card>

      <Card title="قواعد الموافقة — من يعتمد، بأيّ مبلغ">
        <SimpleTable
          head={["النوع", "من مبلغ", "يعتمده", "الحالة"]}
          rows={(rules ?? []).map((r) => [r.entity_type, fmt(r.min_amount),
            admin ? <FieldSelect key="a" table="mkt_approval_rules" id={r.id} column="approver" value={r.approver} options={["مدير التسويق", "المدير", "المالية"]} /> : r.approver,
            admin ? <ToggleField key="s" table="mkt_approval_rules" id={r.id} column="is_active" value={r.is_active} on="فعّالة" off="موقوفة" /> : (r.is_active ? "فعّالة" : "موقوفة")])} />
        <p className="mt-2 text-xs text-gray-500">أعلى عتبةٍ لا تتجاوز المبلغ هي التي تحكم. والمصروف الذي يتجاوز ميزانية حملته يرتفع إلى المدير مهما صغر.</p>
      </Card>
    </>
  );
}
