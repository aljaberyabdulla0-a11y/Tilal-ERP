"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// زر حذف دفعة — للمدير
export default function DeletePaymentButton({ id }: { id: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm("حذف هذه الدفعة؟")) return;
    setDeleting(true);
    const { error } = await supabase.from("payments").delete().eq("id", id);
    setDeleting(false);
    if (error) {
      alert("تعذّر الحذف: " + error.message);
      return;
    }
    router.refresh();
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-xs text-red-600 transition hover:text-red-800 disabled:opacity-50"
    >
      {deleting ? "..." : "حذف"}
    </button>
  );
}
