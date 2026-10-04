import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing } from "@/lib/auth";
import { getMarketingVendors } from "@/lib/marketing";
import { fmt } from "@/lib/marketing-style";
import { Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm from "@/components/marketing/record-form";

// ============================================================
// موردو التسويق — في جدول الموردين نفسه (suppliers) بعلَم is_marketing.
// لا جدول موردين ثانٍ: المطبعة التي يشتري منها المخزون بروشوراته هي
// نفسها التي يدفع لها التسويق، ورصيدها واحد.
//
// الأداء من المصروفات (122): كم دُفع له، ولأيّ حملات.
// ============================================================
export default async function VendorsPage() {
  await requireMktRead();
  const supabase = await createClient();
  const [vendors, write, { data: spend }] = await Promise.all([
    getMarketingVendors(), canWriteMarketing(),
    supabase.from("mkt_expenses").select("vendor_id, amount_iqd, status, campaign_id").not("vendor_id", "is", null),
  ]);
  const paid = new Map<string, number>();
  const committed = new Map<string, number>();
  const camps = new Map<string, Set<string>>();
  for (const e of spend ?? []) {
    if (e.status === "مدفوع") paid.set(e.vendor_id!, (paid.get(e.vendor_id!) ?? 0) + Number(e.amount_iqd));
    if (e.status === "معتمد") committed.set(e.vendor_id!, (committed.get(e.vendor_id!) ?? 0) + Number(e.amount_iqd));
    if (e.campaign_id) camps.set(e.vendor_id!, (camps.get(e.vendor_id!) ?? new Set()).add(e.campaign_id));
  }

  return (
    <>
      <PageHead title="موردو التسويق" sub="وكالات، مطابع، شركات لوحات، مصوّرون، شركات فعاليات، ومؤثرون يُدفع لهم بفاتورة." />
      {write && (
        <RecordForm table="suppliers" openLabel="مورّد جديد" fixed={{ is_marketing: true, is_active: true }}
          fields={[
            { name: "name", label: "الاسم", required: true, span: 2 },
            { name: "services", label: "الخدمات", type: "tags", placeholder: "طباعة، لوحات، تصوير" , hint: "افصل بفاصلة" },
            { name: "contact_person", label: "مسؤول التواصل" },
            { name: "phone", label: "الهاتف", ltr: true },
            { name: "email", label: "البريد", ltr: true },
            { name: "rating", label: "التقييم (١–٥)", type: "number" },
            { name: "contract_notes", label: "العقد والأسعار", type: "textarea", span: 3 },
          ]} />
      )}
      <Card>
        <SimpleTable
          empty="لا موردو تسويق بعد."
          head={["المورّد", "الخدمات", "التواصل", "التقييم", "مدفوع", "ملتزم", "حملات"]}
          rows={vendors.map((v) => [
            <span key="n" className={v.is_active ? "font-medium" : "text-gray-400"}>{v.name}</span>,
            <span key="s" className="text-xs">{v.services.join("، ") || "—"}</span>,
            <span key="c" className="text-xs">{v.contact_person ?? ""}<span className="block" dir="ltr">{v.phone ?? ""} {v.email ?? ""}</span></span>,
            v.rating ? "★".repeat(v.rating) : "—",
            fmt(paid.get(v.id) ?? 0), fmt(committed.get(v.id) ?? 0), fmt(camps.get(v.id)?.size ?? 0),
          ])}
        />
      </Card>
    </>
  );
}
