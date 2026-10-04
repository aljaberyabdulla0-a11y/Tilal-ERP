import { requireMktMoney } from "@/lib/marketing-guard";
import { canWriteMarketing, isAdmin } from "@/lib/auth";
import { getBudgetStatus, getCampaignsLite, getChannels, getMktProjects } from "@/lib/marketing";
import { BUDGET_PERIODS, BUDGET_SCOPES, fmt, fmtPct } from "@/lib/marketing-style";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHead, Tile, Unavailable } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";
import { FieldSelect, RpcButton } from "@/components/marketing/actions";

// ============================================================
// الميزانيات — سنوية وربعية وشهرية، على الشركة أو مشروع أو حملة أو
// قناة أو نشاط. المصروف والملتزم يُحسبان من المصروفات (122) لا يُكتبان،
// والتنبيه عند ٨٠٪ و٩٠٪ و١٠٠٪ والتجاوز يُطلقه mkt-automation-scan.
// ============================================================
export default async function BudgetPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktMoney();
  const year = /^\d{4}$/.test(searchParams.year ?? "") ? searchParams.year : String(new Date().getFullYear());
  const supabase = await createClient();
  const [status, write, admin, projects, campaigns, channels, { data: activities }] = await Promise.all([
    getBudgetStatus(`${year}-01-01`, `${year}-12-31`), canWriteMarketing(), isAdmin(),
    getMktProjects(), getCampaignsLite(), getChannels(),
    supabase.from("mkt_activities").select("id, title").order("created_at", { ascending: false }).limit(200),
  ]);
  const rows = status.data;
  const approved = rows.filter((r) => r.status === "معتمدة");
  const company = approved.filter((r) => r.scope === "شركة" && r.period_type === "سنوي");

  return (
    <>
      <PageHead title="ميزانيات التسويق"
        sub="الميزانية تُخطَّط ثم يعتمدها المدير. المصروف = المدفوع في فترتها ونطاقها، والملتزم = المعتمد غير المدفوع — كلاهما من المصروفات لا من رقم يُكتب." />
      <form method="get" className="flex items-end gap-2 text-sm">
        <label><span className="text-xs text-gray-500">السنة</span>
          <input name="year" defaultValue={year} dir="ltr" className="mt-1 block w-24 rounded border border-gray-300 px-2 py-1.5" /></label>
        <button className="rounded-lg border px-3 py-1.5">اعرض</button>
      </form>
      <Unavailable error={status.error} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={`ميزانية الشركة ${year}`} value={company.length ? fmt(company.reduce((s, r) => s + Number(r.approved ?? r.planned), 0)) : "—"} sub={company.length ? undefined : "لا ميزانية سنوية معتمدة"} />
        <Tile label="المصروف عليها" value={fmt(company.reduce((s, r) => s + Number(r.spent), 0))} />
        <Tile label="الملتزم" value={fmt(company.reduce((s, r) => s + Number(r.committed), 0))} tone="warn" />
        <Tile label="ميزانيات بتنبيه" value={fmt(rows.filter((r) => r.alert_level).length)} tone={rows.some((r) => r.alert_level === "تجاوز") ? "bad" : undefined} />
      </section>

      {write && (
        <RecordForm table="mkt_budgets" openLabel="ميزانية جديدة" title="ميزانية جديدة"
          initial={{ period_type: "شهري", scope: "شركة", period_start: `${year}-01-01` }}
          fields={[
            { name: "name", label: "الاسم", required: true, span: 2, placeholder: "تسويق لاماك — الربع الرابع" },
            { name: "planned", label: "المخطّط (د.ع)", type: "number", required: true },
            { name: "period_type", label: "الفترة", type: "select", options: BUDGET_PERIODS, required: true },
            { name: "period_start", label: "بدايتها", type: "date", required: true, hint: "أول الشهر/الربع/السنة — النهاية تُحسب" },
            { name: "scope", label: "النطاق", type: "select", options: BUDGET_SCOPES, required: true },
            { name: "project_id", label: "المشروع (للنطاق)", type: "select", options: projects.map((p) => ({ value: p.id, label: p.name })) },
            { name: "campaign_id", label: "الحملة (للنطاق)", type: "select", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
            { name: "channel_id", label: "القناة (للنطاق)", type: "select", options: channels.map((c) => ({ value: c.id, label: c.name })) },
            { name: "activity_id", label: "النشاط (للنطاق)", type: "select", options: (activities ?? []).map((a) => ({ value: a.id, label: a.title })) },
            { name: "forecast", label: "التوقّع (اختياري)", type: "number" },
            { name: "notes", label: "ملاحظات", type: "textarea", span: 3 },
          ]} />
      )}

      <Card>
        <SimpleTable
          empty={`لا ميزانيات في ${year}.`}
          head={["الميزانية", "النطاق", "الفترة", "الحالة", "المخطّط", "المعتمد", "الملتزم", "المصروف", "المتبقّي", "الاستهلاك", ""]}
          rows={rows.map((b) => [
            b.name,
            <span key="s" className="text-xs">{b.scope} — {b.scope_label}</span>,
            <span key="p" dir="ltr" className="text-xs">{b.period_type} · {b.period_start} → {b.period_end}</span>,
            <Badge key="st">{b.status}</Badge>,
            fmt(b.planned), fmt(b.approved), fmt(b.committed), fmt(b.spent),
            <span key="r" className={Number(b.remaining) < 0 ? "font-semibold text-red-600" : ""}>{fmt(b.remaining)}</span>,
            <span key="u" className="block w-28">
              <span className="block h-2 rounded bg-gray-100">
                <span className={`block h-2 rounded-e ${b.alert_level === "تجاوز" ? "bg-red-500" : b.alert_level ? "bg-amber-500" : "bg-brand-500"}`}
                  style={{ width: `${Math.min(100, Number(b.utilization_pct ?? 0))}%` }} title={fmtPct(b.utilization_pct)} />
              </span>
              <span className="text-xs text-gray-500">{fmtPct(b.utilization_pct)}{b.alert_level ? ` · ${b.alert_level}` : ""}</span>
            </span>,
            <span key="x" className="flex gap-1">
              {write && b.status === "مسودة" && <RpcButton small fn="mkt_request_approval" args={{ p_type: "ميزانية", p_id: b.budget_id }} label="اطلب الاعتماد" />}
              {admin && b.status === "معتمدة" && <FieldSelect table="mkt_budgets" id={b.budget_id} column="status" value={b.status} options={["معتمدة", "مغلقة"]} />}
            </span>,
          ])}
        />
      </Card>
    </>
  );
}
