"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// زر حذف فاتورة (تُحذف دفعاتها تلقائياً عبر cascade) — للمدير
export default function DeleteInvoiceButton({ id }: { id: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm("حذف هذه الفاتورة وكل دفعاتها؟")) return;
    setDeleting(true);
    const { error } = await supabase.from("invoices").delete().eq("id", id);
    setDeleting(false);
    if (error) {
      alert("تعذّر الحذف: " + error.message);
      return;
    }
    router.push("/dashboard/invoices");
    router.refresh();
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-sm text-red-600 transition hover:text-red-800 disabled:opacity-50"
    >
      {deleting ? "..." : "حذف"}
    </button>
  );
}
