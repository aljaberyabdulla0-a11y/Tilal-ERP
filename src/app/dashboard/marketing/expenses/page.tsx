import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMktMoney } from "@/lib/marketing-guard";
import { canManageFinance, canWriteMarketing, isMarketingManager } from "@/lib/auth";
import { getCampaignsLite, getChannels, getMarketingVendors, getMktProjects } from "@/lib/marketing";
import { ARMS, EXPENSE_CATEGORIES, EXPENSE_STATUSES, fmt } from "@/lib/marketing-style";
import { Badge, Card, PageHead, Tile } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm, { type FieldSpec } from "@/components/marketing/record-form";
import { RpcButton } from "@/components/marketing/actions";
import PayExpense from "./pay-expense";
import ExpenseInvoice from "./invoice";
import LinkMove from "./link-move";
import Pager from "@/components/pager";

// ============================================================
// مصروفات التسويق — من الطلب إلى الدفتر.
//
//   التسويق: يسجّل المصروف ← يطلب الموافقة
//   مدير التسويق / المدير: يعتمد (المبلغ والتجاوز يحدّدان من)
//   المالية: «ادفع» ← cash_moves (5700) ← القيد بمحفّزه القائم
//
// والحركات التي سُجّلت في المحاسبة قبل القسم تُربط هنا («اربط حركة»)
// فتدخل كلفة حملتها بلا ترحيل ثانٍ.
// ============================================================
const PAGE = 50;

type Row = {
  id: string; code: string; expense_date: string; category: string; description: string;
  amount: number; currency: string; amount_iqd: number; status: string; campaign_id: string | null;
  vendor_id: string | null; project_id: string | null; invoice_ref: string | null; paid_at: string | null;
  cash_move_id: string | null; void_reason: string | null;
  fx_rate: number; channel_id: string | null; invoice_asset_id: string | null;
  invoice: { storage_path: string } | null;
};

// Fields of editing the expense before approval — the same as creation minus the creation; the guard (122, 195)
// sends the approved one back to draft if its amount or campaign changes
function expenseFields(campaigns: { id: string; name: string }[], channels: { id: string; name: string }[],
  projects: { id: string; name: string }[], vendors: { id: string; name: string }[]): FieldSpec[] {
  return [
    { name: "description", label: "البيان", required: true, span: 2 },
    { name: "category", label: "التصنيف", type: "select", options: EXPENSE_CATEGORIES, required: true },
    { name: "amount", label: "المبلغ", type: "number", required: true },
    { name: "currency", label: "العملة", type: "select", options: ["IQD", "USD"], required: true },
    { name: "fx_rate", label: "سعر الصرف", type: "number", hint: "١ للدينار؛ للدولار: كم ديناراً للدولار" },
    { name: "expense_date", label: "التاريخ", type: "date" },
    { name: "campaign_id", label: "الحملة", type: "select", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
    { name: "channel_id", label: "القناة", type: "select", options: channels.map((c) => ({ value: c.id, label: c.name })) },
    { name: "project_id", label: "المشروع", type: "select", options: projects.map((p) => ({ value: p.id, label: p.name })) },
    { name: "vendor_id", label: "المورّد", type: "select", options: vendors.map((v) => ({ value: v.id, label: v.name })) },
    { name: "invoice_ref", label: "رقم فاتورة المورّد" },
  ];
}

export default async function ExpensesPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktMoney();
  const sp = searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let q = supabase.from("mkt_expenses").select("*, invoice:mkt_assets(storage_path)", { count: "exact" });
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.category) q = q.eq("category", sp.category);
  if (sp.campaign) q = q.eq("campaign_id", sp.campaign);
  if (sp.vendor) q = q.eq("vendor_id", sp.vendor);
  if (sp.project) q = q.eq("project_id", sp.project);
  if (sp.from) q = q.gte("expense_date", sp.from);
  if (sp.to) q = q.lte("expense_date", sp.to);
  q = q.order("expense_date", { ascending: false }).order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);

  const [{ data, count }, finance, write, manager, campaigns, vendors, projects, channels, totals, { data: partners }, { data: unlinked }] = await Promise.all([
    q, canManageFinance(), canWriteMarketing(), isMarketingManager(), getCampaignsLite(), getMarketingVendors(), getMktProjects(), getChannels(),
    supabase.from("mkt_expenses").select("status, amount_iqd").in("status", ["بانتظار الموافقة", "معتمد", "مدفوع"]),
    supabase.from("partners").select("id, name").order("name"),
    supabase.from("cash_moves").select("id, move_date, amount, description").eq("account_code", "5700").eq("direction", "صرف")
      .order("move_date", { ascending: false }).limit(200),
  ]);
  const rows = (data ?? []) as Row[];
  const sum = (s: string) => (totals.data ?? []).filter((r) => r.status === s).reduce((a, r) => a + Number(r.amount_iqd), 0);
  const camp = new Map(campaigns.map((c) => [c.id, c.name]));
  const vend = new Map(vendors.map((v) => [v.id, v.name]));
  const { data: linked } = await supabase.from("mkt_expenses").select("cash_move_id").not("cash_move_id", "is", null);
  const linkedSet = new Set((linked ?? []).map((l) => l.cash_move_id));
  const freeMoves = (unlinked ?? []).filter((m) => !linkedSet.has(m.id));
  const params = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "page" && v));
  const sel = "mt-1 rounded border border-gray-300 bg-white px-2 py-1.5";

  return (
    <>
      <PageHead title="مصروفات التسويق"
        sub="التسويق يطلب، والمالية تدفع، والقيد يكتبه محفّز الحركات القائم على 5700 «تسويق». المبلغ يتجمّد بعد الدفع؛ التصحيح إلغاءٌ بحركة معاكسة." />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="بانتظار الموافقة" value={fmt(sum("بانتظار الموافقة"))} tone="warn" href="/dashboard/marketing/expenses?status=بانتظار الموافقة" />
        <Tile label="معتمد بانتظار الدفع (ملتزم)" value={fmt(sum("معتمد"))} tone="warn" href="/dashboard/marketing/expenses?status=معتمد" />
        <Tile label="مدفوع (كل الوقت)" value={fmt(sum("مدفوع"))} tone="brand" />
        <Tile label="حركات 5700 غير منسوبة" value={fmt(freeMoves.length)} sub="من المحاسبة قبل القسم" tone={freeMoves.length ? "warn" : undefined} />
      </section>

      {write && (
        <RecordForm table="mkt_expenses" openLabel="مصروف جديد" title="مصروف تسويق جديد"
          initial={{ currency: "IQD", fx_rate: "1" }}
          fields={expenseFields(campaigns, channels, projects, vendors)} />
      )}

      {(finance || manager) && freeMoves.length > 0 && (
        <Card title="حركات تسويق في المحاسبة غير منسوبة">
          <p className="mb-2 text-xs text-gray-500">انسبها إلى حملتها — تدخل كلفة الحملة ولا تُرحَّل مرّة ثانية.</p>
          <LinkMove moves={freeMoves} campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
            channels={channels.map((c) => ({ id: c.id, name: c.name }))} categories={[...EXPENSE_CATEGORIES]} />
        </Card>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
        <label className="block"><span className="text-xs text-gray-500">الحالة</span>
          <select name="status" defaultValue={sp.status ?? ""} className={sel}><option value="">الكل</option>{EXPENSE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="block"><span className="text-xs text-gray-500">التصنيف</span>
          <select name="category" defaultValue={sp.category ?? ""} className={sel}><option value="">الكل</option>{EXPENSE_CATEGORIES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="block"><span className="text-xs text-gray-500">الحملة</span>
          <select name="campaign" defaultValue={sp.campaign ?? ""} className={`${sel} max-w-[12rem]`}><option value="">الكل</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block"><span className="text-xs text-gray-500">المورّد</span>
          <select name="vendor" defaultValue={sp.vendor ?? ""} className={sel}><option value="">الكل</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className="block"><span className="text-xs text-gray-500">من</span><input type="date" name="from" defaultValue={sp.from ?? ""} dir="ltr" className={sel} /></label>
        <label className="block"><span className="text-xs text-gray-500">إلى</span><input type="date" name="to" defaultValue={sp.to ?? ""} dir="ltr" className={sel} /></label>
        <button className="rounded-lg bg-brand-600 px-4 py-1.5 font-semibold text-white">طبّق</button>
      </form>

      <Card>
        <SimpleTable
          empty="لا مصروفات بهذه المُرشِّحات."
          head={["الرمز", "التاريخ", "البيان", "الحملة / المورّد", "المبلغ", "الحالة", "إجراء"]}
          rows={rows.map((e) => [
            <span key="c" dir="ltr" className="font-mono text-xs">{e.code}</span>,
            <span key="d" dir="ltr" className="text-xs">{e.expense_date}</span>,
            <span key="b">{e.description}<span className="block text-xs text-gray-400">{e.category}{e.invoice_ref ? ` · فاتورة ${e.invoice_ref}` : ""}</span></span>,
            <span key="cv" className="text-xs">
              {e.campaign_id ? <Link href={`/dashboard/marketing/campaigns/${e.campaign_id}`} className="hover:text-brand-600">{camp.get(e.campaign_id) ?? "—"}</Link> : "—"}
              <span className="block text-gray-400">{vend.get(e.vendor_id ?? "") ?? ""}</span>
            </span>,
            <span key="a" className="tabular-nums">{fmt(e.amount_iqd)}{e.currency !== "IQD" && <span className="block text-xs text-gray-400">{fmt(e.amount)} {e.currency}</span>}</span>,
            <span key="s"><Badge>{e.status}</Badge>{e.void_reason && <span className="block text-xs text-gray-400">{e.void_reason}</span>}</span>,
            <span key="x" className="flex flex-wrap gap-1">
              {write && ["مسودة", "مرفوض"].includes(e.status) && (
                <RpcButton small fn="mkt_request_approval" args={{ p_type: "مصروف", p_id: e.id }} label="اطلب الموافقة" />
              )}
              {finance && e.status === "معتمد" && (
                <PayExpense id={e.id} code={e.code} amount={Number(e.amount_iqd)} partners={partners ?? []} arms={[...ARMS]} />
              )}
              {((write && ["مسودة", "مرفوض"].includes(e.status)) || ((manager || finance) && e.status === "معتمد") || (finance && e.status === "مدفوع")) && (
                <RpcButton small tone="danger" fn="mkt_void_expense" args={{ p_id: e.id }} label="ألغِ"
                  prompt={e.status === "مدفوع" ? "سبب الإلغاء — يُسجَّل استردادٌ بحركة معاكسة (قبض على 5700)" : "سبب الإلغاء"}
                  promptKey="p_reason" promptRequired />
              )}
              {e.cash_move_id && <Link href="/dashboard/accounting/moves" className="text-xs text-gray-500 hover:underline">حركته</Link>}
              <ExpenseInvoice expenseId={e.id} code={e.code} path={e.invoice?.storage_path ?? null}
                canAttach={write && e.status !== "ملغى"} campaignId={e.campaign_id} projectId={e.project_id} />
              {write && ["مسودة", "مرفوض"].includes(e.status) && (
                <RecordForm table="mkt_expenses" id={e.id} openLabel="عدّل" openIcon="edit" submitLabel="احفظ التعديل"
                  initial={e as unknown as Record<string, unknown>} fields={expenseFields(campaigns, channels, projects, vendors)} />
              )}
            </span>,
          ])}
        />
      </Card>
      <Pager total={count ?? 0} page={page} pageSize={PAGE} basePath="/dashboard/marketing/expenses" params={params} unit="مصروفاً" />
    </>
  );
}
