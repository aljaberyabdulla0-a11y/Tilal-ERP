import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canManageInventory, canWriteMarketing } from "@/lib/auth";
import { getCampaignsLite, getMarketingVendors } from "@/lib/marketing";
import { fmt } from "@/lib/marketing-style";
import { Badge, Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";
import { RpcButton } from "@/components/marketing/actions";
import ReceivePurchase from "./receive";
import IssueMaterial from "./issue";

// ============================================================
// المشتريات والمواد التسويقية — فوق المخزون القائم:
//
//   طلب شراء (موافقة) → المخزون يسجّل الشراء (حركة «شراء»، قيد 5350)
//   → التسويق يصرف للحملة أو النشاط → كلفة المادّة على الحملة.
//
// صنف «مطبوعات ومواد تسويقية» في inventory_items — لا مخزون ثانٍ.
// ============================================================
export default async function ProcurementPage() {
  await requireMktRead();
  const supabase = await createClient();
  const [write, invManager, campaigns, vendors, { data: requests }, { data: items }, { data: moves }, { data: activities }] = await Promise.all([
    canWriteMarketing(), canManageInventory(), getCampaignsLite(), getMarketingVendors(),
    supabase.from("mkt_purchase_requests").select("*").order("created_at", { ascending: false }).limit(200),
    supabase.from("inventory_items").select("id, name, unit, quantity, last_purchase_price").eq("category", "مطبوعات ومواد تسويقية").order("name"),
    supabase.from("inventory_moves").select("id, item_id, kind, quantity, total_price, moved_at, issued_to, mkt_campaign_id, mkt_activity_id")
      .or("mkt_campaign_id.not.is.null,mkt_activity_id.not.is.null").order("moved_at", { ascending: false }).limit(100),
    supabase.from("mkt_activities").select("id, title").not("status", "in", "(منتهٍ,ملغى)").order("start_date", { ascending: false }),
  ]);
  const itemName = new Map((items ?? []).map((i) => [i.id, i.name]));
  const camp = new Map(campaigns.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHead title="المشتريات والمواد التسويقية" sub="بروشورات، رول أب، بانرات، هدايا، زيّ موحّد… تُطلب بموافقة، ويشتريها المخزون، ويصرفها التسويق على حملتها." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="المخزون التسويقي">
          <SimpleTable empty="لا أصناف تسويقية في المخزون."
            head={["الصنف", "الرصيد", "آخر سعر"]}
            rows={(items ?? []).map((i) => [i.name, `${fmt(i.quantity)} ${i.unit ?? ""}`, fmt(i.last_purchase_price)])} />
        </Card>
        {write && (
          <Card title="صرف مادّة لحملة أو نشاط">
            <IssueMaterial items={(items ?? []).filter((i) => Number(i.quantity) > 0).map((i) => ({ id: i.id, name: i.name, quantity: Number(i.quantity) }))}
              campaigns={campaigns.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name }))}
              activities={(activities ?? []).map((a) => ({ id: a.id, name: a.title }))} />
          </Card>
        )}
      </div>

      {write && (
        <RecordForm table="mkt_purchase_requests" openLabel="طلب شراء" title="طلب شراء مواد تسويقية"
          fields={[
            { name: "item_name", label: "الصنف", required: true, span: 2, placeholder: "بروشور لاماك A4 — ٢٠٠٠ نسخة" },
            { name: "item_id", label: "صنف قائم في المخزون (اختياري)", type: "select", options: (items ?? []).map((i) => ({ value: i.id, label: i.name })) },
            { name: "quantity", label: "الكمية", type: "number", required: true },
            { name: "estimated_cost", label: "الكلفة التقديرية", type: "number" },
            { name: "needed_by", label: "مطلوب قبل", type: "date" },
            { name: "campaign_id", label: "الحملة", type: "select", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
            { name: "activity_id", label: "النشاط", type: "select", options: (activities ?? []).map((a) => ({ value: a.id, label: a.title })) },
            { name: "vendor_id", label: "المورّد المقترح", type: "select", options: vendors.map((v) => ({ value: v.id, label: v.name })) },
            { name: "notes", label: "ملاحظات", type: "textarea", span: 3 },
          ]} />
      )}

      <Card title="طلبات الشراء">
        <SimpleTable empty="لا طلبات."
          head={["الرمز", "الصنف", "الكمية", "التقدير", "الحملة", "الحالة", "إجراء"]}
          rows={(requests ?? []).map((r) => [
            <span key="c" dir="ltr" className="font-mono text-xs">{r.code}</span>, r.item_name, fmt(r.quantity), fmt(r.estimated_cost),
            camp.get(r.campaign_id ?? "") ?? "—", <Badge key="s">{r.status}</Badge>,
            <span key="x" className="flex flex-wrap gap-1">
              {write && r.status === "مسودة" && <RpcButton small fn="mkt_request_approval" args={{ p_type: "شراء", p_id: r.id }} label="اطلب الموافقة" />}
              {invManager && r.status === "معتمد" && <ReceivePurchase id={r.id} vendors={vendors.map((v) => ({ id: v.id, name: v.name }))} />}
            </span>,
          ])} />
        {!invManager && <p className="mt-2 text-xs text-gray-500">تسجيل الشراء لمن يدير المخزون (المدير ومدير المتابعة) — يُرحَّل على 5350 بمساره القائم.</p>}
      </Card>

      <Card title="آخر ما صُرف للتسويق">
        <SimpleTable empty="لا صرف بعد."
          head={["التاريخ", "الصنف", "الحركة", "الكمية", "الكلفة", "إلى"]}
          rows={(moves ?? []).map((m) => [<span key="d" dir="ltr">{m.moved_at}</span>, itemName.get(m.item_id) ?? "—", m.kind, fmt(m.quantity), fmt(m.total_price),
            camp.get(m.mkt_campaign_id ?? "") ?? m.issued_to ?? "—"])} />
      </Card>
    </>
  );
}
