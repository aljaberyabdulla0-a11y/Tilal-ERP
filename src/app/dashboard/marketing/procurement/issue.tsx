"use client";

import RpcForm from "@/components/marketing/rpc-form";

// صرف مادّة تسويقية — بكلفة آخر شراء، على الحملة أو النشاط
export default function IssueMaterial({
  items, campaigns, activities,
}: {
  items: { id: string; name: string; quantity: number }[];
  campaigns: { id: string; name: string }[];
  activities: { id: string; name: string }[];
}) {
  if (items.length === 0) return <p className="text-sm text-gray-400">لا رصيد في المخزون التسويقي.</p>;
  return (
    <RpcForm fn="mkt_issue_material" submitLabel="اصرف" resultMessage="صُرف — دخلت كلفته على الحملة."
      fields={[
        { name: "p_item", label: "الصنف", type: "select", required: true, span: 2,
          options: items.map((i) => ({ value: i.id, label: `${i.name} (الرصيد ${i.quantity})` })) },
        { name: "p_qty", label: "الكمية", type: "number", required: true },
        { name: "p_campaign", label: "الحملة", type: "select", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
        { name: "p_activity", label: "النشاط", type: "select", options: activities.map((a) => ({ value: a.id, label: a.name })) },
        { name: "p_note", label: "ملاحظة" },
      ]} />
  );
}
