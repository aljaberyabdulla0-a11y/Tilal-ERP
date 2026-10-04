import type { FieldSpec } from "@/components/marketing/record-form";
import { CAMPAIGN_MODES, CAMPAIGN_TYPES } from "@/lib/marketing-style";
import type { Channel, Person, ProjectLite } from "@/lib/marketing";

// حقول الحملة — مشتركة بين «حملة جديدة» و«تعديل». الحالة ليست هنا:
// تتغيّر بالموافقة أو بزرّ الحالة، لا بنموذج.
export function campaignFields(opts: {
  projects: ProjectLite[];
  channels: Channel[];
  people: Person[];
  audiences: { id: string; name: string }[];
  plans: { id: string; title: string }[];
}): FieldSpec[] {
  return [
    { name: "name", label: "اسم الحملة", required: true, span: 2, placeholder: "لاماك — إطلاق أكتوبر ٢٠٢٦",
      hint: "الاسم مفتاح مطابقة الليدات الواردة — غيّره بحذر" },
    { name: "code", label: "الرمز (utm_campaign)", ltr: true, placeholder: "يُولَّد تلقائياً: cmp-0001",
      hint: "لاتيني صغير وأرقام و- فقط" },
    { name: "campaign_type", label: "النوع", type: "select", options: CAMPAIGN_TYPES, required: true },
    { name: "mode", label: "رقمي / ميداني", type: "select", options: CAMPAIGN_MODES, required: true },
    { name: "objective", label: "الهدف", placeholder: "١٥٠٠ ليد مؤهَّل بكلفة أقل من ١٠ آلاف" },
    { name: "project_id", label: "المشروع", type: "select", options: opts.projects.map((p) => ({ value: p.id, label: p.name })) },
    { name: "channel_id", label: "القناة الرئيسية", type: "select", options: opts.channels.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name })) },
    { name: "owner_employee_id", label: "المسؤول", type: "select", options: opts.people.map((p) => ({ value: p.id, label: p.full_name + (p.mkt_role ? ` — ${p.mkt_role}` : "") })) },
    { name: "audience_id", label: "الجمهور", type: "select", options: opts.audiences.map((a) => ({ value: a.id, label: a.name })) },
    { name: "plan_id", label: "ضمن خطة", type: "select", options: opts.plans.map((p) => ({ value: p.id, label: p.title })) },
    { name: "unit_type", label: "نوع الوحدة المستهدفة", placeholder: "شقة ٣ غرف" },
    { name: "start_date", label: "من", type: "date" },
    { name: "end_date", label: "إلى", type: "date" },
    { name: "budget", label: "الميزانية (د.ع)", type: "number" },
    { name: "target_cpl", label: "كلفة الليد المستهدفة", type: "number" },
    { name: "expected_leads", label: "ليدات متوقعة", type: "number" },
    { name: "expected_qualified", label: "مؤهَّلون متوقعون", type: "number" },
    { name: "expected_reservations", label: "حجوزات متوقعة", type: "number" },
    { name: "expected_sales", label: "بيعات متوقعة", type: "number" },
    { name: "expected_revenue", label: "عمولة متوقعة (د.ع)", type: "number", hint: "عمولة تلال لا قيمة البيع" },
    { name: "notes", label: "ملاحظات", type: "textarea", span: 3 },
  ];
}
