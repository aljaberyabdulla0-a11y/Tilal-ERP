import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canManageFinance, canWriteMarketing, isAdmin, isMarketingManager } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { parseMktFilters } from "@/lib/marketing-filters";
import { canDecideApproval, getBreakdown, getCampaignsLite, getChannels, getEntityApprovals, getMarketingVendors, getMktProjects, getPeople, peopleMap } from "@/lib/marketing";
import { ACTIVITY_KINDS, TASK_PRIORITIES, TASK_STATUSES, fmt, fmtPct } from "@/lib/marketing-style";
import { Badge, Card, PageHead, Tile } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";
import { FieldSelect, RpcButton } from "@/components/marketing/actions";
import MetricEntry from "@/components/marketing/metric-entry";
import Checklist from "../../tasks/checklist";
import { AssetDownload, AssetUploader } from "../../assets/uploader";
import { ASSET_TYPES } from "@/lib/marketing-style";

// النشاط أو الفعالية: الفريق، قائمة التجهيز، الرمز، الصور، المواد، المصروف، النتائج.
const STATUS_FLOW = ["مخطط", "قيد التنفيذ", "نشط", "منتهٍ", "ملغى"] as const;

export default async function ActivityPage({ params }: { params: { id: string } }) {
  await requireMktRead();
  const supabase = await createClient();
  const { data: a } = await supabase.from("mkt_activities").select("*").eq("id", params.id).maybeSingle();
  if (!a) notFound();

  const [write, manager, people, campaigns, channels, projects, vendors, approvals, perf,
    { data: staff }, { data: tasks }, { data: links }, { data: assets }, { data: materials }, { data: expenses }] = await Promise.all([
    canWriteMarketing(), isMarketingManager(), getPeople(), getCampaignsLite(), getChannels(), getMktProjects(), getMarketingVendors(),
    getEntityApprovals("نشاط", a.id), getBreakdown("activity", parseMktFilters({ range: "all" }, baghdadDate())),
    supabase.from("mkt_activity_staff").select("employee_id, role").eq("activity_id", a.id),
    supabase.from("mkt_tasks").select("*").eq("activity_id", a.id).order("due_date", { nullsFirst: false }),
    supabase.from("mkt_tracking_links").select("id, code, name, is_qr").eq("activity_id", a.id),
    supabase.from("mkt_assets").select("id, title, asset_type, storage_path, created_at").eq("activity_id", a.id).neq("status", "مؤرشف"),
    supabase.from("inventory_moves").select("id, quantity, total_price, moved_at, item_id").eq("mkt_activity_id", a.id),
    supabase.from("mkt_expenses").select("id, code, description, amount_iqd, status").eq("activity_id", a.id),
  ]);
  const names = peopleMap(people);
  const p = perf.data.find((r) => r.dim_key === a.id);
  const pending = approvals.find((x) => x.status === "معلّق");
  const [admin, finance] = await Promise.all([isAdmin(), canManageFinance()]);
  const decide = pending ? canDecideApproval(pending, { admin, manager, finance }) : false;
  const isEvent = a.category === "فعالية";

  return (
    <>
      <PageHead title={a.title}
        sub={`${a.code} · ${a.kind} · ${[a.city, a.location, a.venue].filter(Boolean).join(" — ") || "بلا مكان"} · ${a.start_date ?? "—"} → ${a.end_date ?? "—"} · المسؤول: ${names.get(a.responsible_employee_id ?? "") ?? "—"}`}
        actions={<>
          <Badge>{a.status}</Badge>
          {write && !pending && a.status === "مخطط" && <RpcButton fn="mkt_request_approval" args={{ p_type: "نشاط", p_id: a.id }} label="اطلب الاعتماد" icon="approval" />}
          {decide && pending && <RpcButton fn="mkt_decide_approval" args={{ p_id: pending.id, p_approve: true }} label="اعتمد" icon="check" />}
          {decide && pending && <RpcButton fn="mkt_decide_approval" args={{ p_id: pending.id, p_approve: false }} label="ارفض" tone="danger"
            prompt="سبب الرفض — يصل إلى من طلب" promptKey="p_reason" promptRequired />}
          {pending && !decide && <span className="text-xs text-amber-700">بانتظار اعتماد {pending.approver}</span>}
          {write && !pending && <FieldSelect table="mkt_activities" id={a.id} column="status" value={a.status} options={STATUS_FLOW} small={false} />}
        </>} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Tile label="الميزانية" value={fmt(a.budget)} />
        <Tile label="الكلفة الفعلية" value={fmt(p?.cost)} tone={a.budget && p && p.cost > Number(a.budget) ? "bad" : undefined} sub="مصروف مدفوع + مواد" />
        {isEvent && <Tile label="الزوّار" value={`${fmt(a.actual_visitors)} / ${fmt(a.expected_visitors)}`} />}
        <Tile label="ليدات" value={fmt(p?.leads)} tone="brand" />
        <Tile label="بيعات منسوبة" value={fmt(p?.sales)} sub={`عمولة ${fmt(p?.commission)}`} />
        <Tile label="CPL / ROI" value={fmt(p?.cpl)} sub={fmtPct(p?.roi)} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={isEvent ? "قائمة التجهيز — قاعة، جناح، طباعة، دعوات، فريق، لوجستيات" : "مهامّ التنفيذ"}>
          {write && <div className="mb-3"><RecordForm table="mkt_tasks" openLabel="مهمّة" fixed={{ activity_id: a.id, campaign_id: a.campaign_id, project_id: a.project_id }}
            initial={{ priority: "عادية" }}
            fields={[
              { name: "title", label: "المهمّة", required: true, span: 2 },
              { name: "assignee_id", label: "المكلَّف", type: "select", options: people.map((x) => ({ value: x.id, label: x.full_name })) },
              { name: "priority", label: "الأولوية", type: "select", options: TASK_PRIORITIES, required: true },
              { name: "due_date", label: "الموعد", type: "date" },
            ]} /></div>}
          <ul className="space-y-2">
            {(tasks ?? []).map((t) => (
              <li key={t.id} className="rounded border border-gray-200 p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className={t.status === "منجزة" ? "text-gray-400 line-through" : ""}>{t.title}</span>
                  {write ? <FieldSelect table="mkt_tasks" id={t.id} column="status" value={t.status} options={TASK_STATUSES} /> : <Badge>{t.status}</Badge>}
                </div>
                <p className="text-xs text-gray-500">{names.get(t.assignee_id ?? "") ?? "—"} · <span dir="ltr">{t.due_date ?? ""}</span></p>
                <Checklist id={t.id} items={t.checklist ?? []} canEdit={write} />
              </li>
            ))}
            {(tasks ?? []).length === 0 && <li className="text-sm text-gray-400">لا مهامّ.</li>}
          </ul>
        </Card>

        <div className="space-y-4">
          <Card title="الفريق في الموقع">
            {write && <div className="mb-3"><RecordForm table="mkt_activity_staff" openLabel="أضف موظفاً" fixed={{ activity_id: a.id }} returnsId={false}
              fields={[
                { name: "employee_id", label: "الموظف", type: "select", required: true, options: people.filter((x) => !(staff ?? []).some((s) => s.employee_id === x.id)).map((x) => ({ value: x.id, label: x.full_name })) },
                { name: "role", label: "دوره", placeholder: "استقبال / مبيعات / تصوير" },
              ]} /></div>}
            <ul className="text-sm">{(staff ?? []).map((s) => <li key={s.employee_id}>{names.get(s.employee_id) ?? "—"} <span className="text-xs text-gray-500">{s.role ?? ""}</span></li>)}</ul>
          </Card>

          <Card title="رموز QR وروابط التتبّع" actions={<Link href={`/dashboard/marketing/tracking?activity=${a.id}${a.campaign_id ? `&campaign=${a.campaign_id}` : ""}`} className="text-xs text-brand-600">رمز جديد</Link>}>
            <ul className="text-sm">{(links ?? []).map((l) => <li key={l.id}>{l.name} <span dir="ltr" className="font-mono text-xs text-gray-500">{l.code}</span>{l.is_qr ? " · QR" : ""}</li>)}</ul>
            {(links ?? []).length === 0 && <p className="text-sm text-gray-400">بلا رمز لا يُنسب لهذا النشاط ليدٌ واحد — أنشئ QR للطباعة.</p>}
          </Card>

          <Card title="النتائج">
            {write ? (
              <RecordForm table="mkt_activities" id={a.id} initial={a} submitLabel="احفظ النتائج"
                fields={[
                  { name: "actual_visitors", label: "الزوّار الفعليون", type: "number" },
                  { name: "booth", label: "الجناح", placeholder: "B12 — 6×3" },
                  { name: "sponsors", label: "الرعاة" },
                  { name: "results", label: "تقرير ما بعد النشاط", type: "textarea", span: 3 },
                ]} />
            ) : <p className="whitespace-pre-line text-sm">{a.results ?? "—"}</p>}
            {write && <div className="mt-3"><MetricEntry entityType="نشاط" entityId={a.id} offline /></div>}
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="الصور والمستندات">
          {write && <div className="mb-2"><AssetUploader types={ASSET_TYPES} projects={projects.map((x) => ({ id: x.id, name: x.name }))}
            campaigns={campaigns.map((x) => ({ id: x.id, name: x.name }))} activities={[{ id: a.id, name: a.title }]} /></div>}
          <SimpleTable empty="لا صور." head={["الأصل", ""]}
            rows={(assets ?? []).map((x) => [<span key="t" className="text-xs">{x.asset_type}: {x.title}</span>, <AssetDownload key="d" path={x.storage_path} />])} />
        </Card>
        <Card title="المواد المصروفة" actions={<Link href="/dashboard/marketing/procurement" className="text-xs text-brand-600">اصرف</Link>}>
          <SimpleTable empty="لا مواد." head={["التاريخ", "الكمية", "الكلفة"]}
            rows={(materials ?? []).map((m) => [<span key="d" dir="ltr">{m.moved_at}</span>, fmt(m.quantity), fmt(m.total_price)])} />
        </Card>
        <Card title="المصروفات" actions={<Link href="/dashboard/marketing/expenses" className="text-xs text-brand-600">مصروف</Link>}>
          <SimpleTable empty="لا مصروفات." head={["الرمز", "البيان", "المبلغ", "الحالة"]}
            rows={(expenses ?? []).map((e) => [<span key="c" dir="ltr" className="font-mono text-xs">{e.code}</span>, e.description, fmt(e.amount_iqd), <Badge key="s">{e.status}</Badge>])} />
        </Card>
      </div>

      {write && (
        <Card title="تعديل النشاط">
          <RecordForm table="mkt_activities" id={a.id} initial={a} submitLabel="احفظ"
            fields={[
              { name: "title", label: "العنوان", required: true, span: 2 },
              { name: "kind", label: "النوع", type: "select", options: ACTIVITY_KINDS, required: true },
              { name: "campaign_id", label: "الحملة", type: "select", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
              { name: "project_id", label: "المشروع", type: "select", options: projects.map((x) => ({ value: x.id, label: x.name })) },
              { name: "channel_id", label: "القناة", type: "select", options: channels.map((c) => ({ value: c.id, label: c.name })) },
              { name: "vendor_id", label: "المورّد", type: "select", options: vendors.map((v) => ({ value: v.id, label: v.name })) },
              { name: "city", label: "المدينة" }, { name: "location", label: "الموقع" }, { name: "venue", label: "القاعة" },
              { name: "start_date", label: "من", type: "date" }, { name: "end_date", label: "إلى", type: "date" },
              { name: "budget", label: "الميزانية", type: "number" }, { name: "quantity", label: "الكمية", type: "number" },
              { name: "dimensions", label: "الأبعاد" }, { name: "expected_visitors", label: "زوّار متوقعون", type: "number" },
              { name: "responsible_employee_id", label: "المسؤول", type: "select", options: people.map((x) => ({ value: x.id, label: x.full_name })) },
              { name: "objective", label: "الهدف", span: 3 }, { name: "notes", label: "ملاحظات", type: "textarea", span: 3 },
            ]} />
        </Card>
      )}
    </>
  );
}
