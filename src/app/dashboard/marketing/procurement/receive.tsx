"use client";

import RpcForm from "@/components/marketing/rpc-form";

// تسجيل الشراء المعتمد — المخزون يدخل الحركة بمسارها القائم (قيد 5350)
export default function ReceivePurchase({ id, vendors }: { id: string; vendors: { id: string; name: string }[] }) {
  return (
    <RpcForm fn="mkt_receive_purchase" fixed={{ p_id: id }} openLabel="سجّل الشراء" submitLabel="سجّل" compact
      fields={[
        { name: "p_unit_price", label: "سعر الوحدة", type: "number", required: true },
        { name: "p_supplier", label: "المورّد", type: "select", options: vendors.map((v) => ({ value: v.id, label: v.name })) },
        { name: "p_date", label: "تاريخ الشراء", type: "date" },
      ]} />
  );
}
