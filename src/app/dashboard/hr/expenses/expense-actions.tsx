"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// الإيصال برابط موقَّع، والدفع للمالية — pay_expense (sql/162)
export default function ExpenseActions({
  id, status, receiptPath, canPay,
}: { id: string; status: string; receiptPath: string | null; canPay: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function openReceipt() {
    if (!receiptPath) return;
    const { data, error } = await supabase.storage.from("expense-receipts").createSignedUrl(receiptPath, 60);
    if (error || !data) return alert("تعذّر فتح الإيصال: " + (error?.message ?? ""));
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function pay(method: string) {
    if (!confirm(`دفع المصروف ${method === "بنك" ? "بالبنك" : "نقداً"}؟ يُسجَّل قيده.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("pay_expense", { p_id: id, p_method: method, p_date: null });
    setBusy(false);
    if (error) return alert(error.message);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      {receiptPath && <button onClick={openReceipt} className="text-brand-700 hover:underline">الإيصال</button>}
      {status === "معتمد" && canPay && (
        <>
          <button disabled={busy} onClick={() => pay("نقد")} className="rounded bg-green-600 px-2 py-0.5 text-white disabled:opacity-50">دفع نقداً</button>
          <button disabled={busy} onClick={() => pay("بنك")} className="rounded border px-2 py-0.5 disabled:opacity-50">بالبنك</button>
        </>
      )}
    </span>
  );
}
