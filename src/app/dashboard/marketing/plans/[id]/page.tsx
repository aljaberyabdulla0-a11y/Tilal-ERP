import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing, isAdmin, isMarketingManager } from "@/lib/auth";
import { canDecideApproval, getCampaignsLite, getChannels, getMktProjects, getObjectiveProgress, getPeople, getEntityApprovals } from "@/lib/marketing";
import { METRIC_LABELS, OBJECTIVE_KINDS, fmt, fmtPct } from "@/lib/marketing-style";
import { Badge, Card, PageHead, Unavailable } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";
import { DeleteRow, RpcButton } from "@/components/marketing/actions";

// الخطة: أهدافها بفعليّها المحسوب، وخططها الفرعية، وحملاتها، وسجلّ اعتمادها.
export default async function PlanPage({ params }: { params: { id: string } }) {
  await requireMktRead();
  const supabase = await createClient();
  const { data: plan } = await supabase.from("mkt_plans").select("*").eq("id", params.id).maybeSingle();
  if (!plan) notFound();

  const [progress, write, admin, projects, channels, campaigns, people, approvals, { data: children }, { data: planCampaigns }] = await Promise.all([
    getObjectiveProgress(plan.id), canWriteMarketing(), isAdmin(), getMktProjects(), getChannels(), getCampaignsLite(), getPeople(),
    getEntityApprovals("خطة", plan.id),
    supabase.from("mkt_plans").select("id, title, kind, status, period_start, period_end").eq("parent_id", plan.id),
    supabase.from("crm_campaigns").select("id, name, status, budget, spent").eq("plan_id", plan.id),
  ]);
  const pending = approvals.find((a) => a.status === "معلّق");
  const manager = await isMarketingManager();
  const decide = pending ? canDecideApproval(pending, { admin, manager }) : false;

  return (
    <>
      <PageHead title={plan.title}
        sub={`${plan.kind} · ${plan.period_start} → ${plan.period_end} · المسؤول: ${people.find((p) => p.id === plan.owner_employee_id)?.full_name ?? "—"} · الميزانية ${fmt(plan.budget)}`}
        actions={<>
          <Badge>{plan.status}</Badge>
          {write && plan.status === "مسودة" && <RpcButton fn="mkt_request_approval" args={{ p_type: "خطة", p_id: plan.id }} label="اطلب الاعتماد" icon="approval" />}
          {decide && pending && <RpcButton fn="mkt_decide_approval" args={{ p_id: pending.id, p_approve: true }} label="اعتمد" icon="check" />}
          {decide && pending && <RpcButton fn="mkt_decide_approval" args={{ p_id: pending.id, p_approve: false }} label="ارفض" tone="danger"
            prompt="سبب الرفض — يصل إلى من طلب" promptKey="p_reason" promptRequired />}
          {pending && !decide && <span className="text-xs text-amber-700">بانتظار اعتماد {pending.approver}</span>}
        </>} />

      {(plan.positioning || plan.value_proposition || plan.hypotheses) && (
        <div className="grid gap-4 md:grid-cols-3">
          {plan.positioning && <Card title="التموضع"><p className="whitespace-pre-line text-sm text-gray-700">{plan.positioning}</p></Card>}
          {plan.value_proposition && <Card title="عرض القيمة"><p className="whitespace-pre-line text-sm text-gray-700">{plan.value_proposition}</p></Card>}
          {plan.hypotheses && <Card title="الفرضيات"><p className="whitespace-pre-line text-sm text-gray-700">{plan.hypotheses}</p></Card>}
        </div>
      )}

      <Card title="الأهداف والمؤشّرات — الفعلي من القاعدة">
        <Unavailable error={progress.error} />
        {write && <div className="mb-4"><RecordForm table="mkt_objectives" openLabel="هدف أو مؤشّر" fixed={{ plan_id: plan.id }}
          initial={{ kind: "هدف", direction: "أعلى" }}
          fields={[
            { name: "title", label: "الهدف", required: true, span: 2, placeholder: "١٥٠٠ ليد مؤهَّل شهرياً للاماك" },
            { name: "kind", label: "النوع", type: "select", options: OBJECTIVE_KINDS, required: true },
            { name: "metric_code", label: "المقياس", type: "select", options: Object.entries(METRIC_LABELS).map(([v, l]) => ({ value: v, label: l })),
              hint: "بلا مقياس: مبادرة أو أولوية تُتابَع نصّاً" },
            { name: "target_value", label: "المستهدف", type: "number" },
            { name: "direction", label: "الأفضل", type: "select", options: [{ value: "أعلى", label: "أعلى (ليدات، عائد)" }, { value: "أدنى", label: "أدنى (كلفة)" }], required: true },
            { name: "project_id", label: "المشروع", type: "select", options: projects.map((p) => ({ value: p.id, label: p.name })) },
            { name: "campaign_id", label: "الحملة", type: "select", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
            { name: "channel_id", label: "القناة", type: "select", options: channels.map((c) => ({ value: c.id, label: c.name })) },
          ]} /></div>}
        <SimpleTable empty="لا أهداف بعد."
          head={["الهدف", "النوع", "المقياس", "المستهدف", "الفعلي", "التقدّم", "", ""]}
          rows={progress.data.map((o) => [
            o.title, o.kind, o.metric_code ? METRIC_LABELS[o.metric_code] ?? o.metric_code : "—", fmt(o.target_value), fmt(o.actual),
            <span key="p" className="block w-28">
              {o.progress_pct != null && (
                <span className="block h-2 rounded bg-gray-100">
                  <span className={`block h-2 rounded-e ${o.on_track ? "bg-brand-500" : "bg-amber-500"}`} style={{ width: `${Math.min(100, Number(o.progress_pct))}%` }} />
                </span>
              )}
              <span className="text-xs text-gray-500">{fmtPct(o.progress_pct)}</span>
            </span>,
            o.on_track == null ? "—" : o.on_track ? <span key="t" className="text-xs text-brand-700">على المسار</span> : <span key="t" className="text-xs text-amber-700">متأخّر</span>,
            write ? <DeleteRow key="d" table="mkt_objectives" id={o.objective_id} /> : null,
          ])} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="خطط فرعية">
          <SimpleTable empty="لا خطط تحتها." head={["الخطة", "النوع", "الفترة", "الحالة"]}
            rows={(children ?? []).map((c) => [<Link key="t" href={`/dashboard/marketing/plans/${c.id}`} className="hover:text-brand-600">{c.title}</Link>, c.kind,
              <span key="d" dir="ltr" className="text-xs">{c.period_start} → {c.period_end}</span>, <Badge key="s">{c.status}</Badge>])} />
        </Card>
        <Card title="حملات الخطة">
          <SimpleTable empty="لا حملات مربوطة — اربطها من نموذج الحملة («ضمن خطة»)." head={["الحملة", "الحالة", "الميزانية", "المصروف"]}
            rows={(planCampaigns ?? []).map((c) => [<Link key="t" href={`/dashboard/marketing/campaigns/${c.id}`} className="hover:text-brand-600">{c.name}</Link>,
              <Badge key="s">{c.status}</Badge>, fmt(c.budget), fmt(c.spent)])} />
        </Card>
      </div>
    </>
  );
}
