"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// حذف حركة مالية — يحذف معها قيدها المحاسبي تلقائياً (عبر محفّز في القاعدة)
export default function DeleteMoveButton({ id }: { id: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!window.confirm("حذف هذه الحركة؟ سيُحذف معها قيدها المحاسبي.")) return;
    setBusy(true);
    const { error } = await supabase.from("cash_moves").delete().eq("id", id);
    setBusy(false);
    if (error) {
      alert("تعذّر الحذف: " + error.message);
      return;
    }
    router.refresh();
  }

  return (
    <button
      onClick={del}
      disabled={busy}
      className="text-xs text-red-600 transition hover:text-red-800 disabled:opacity-50"
    >
      {busy ? "..." : "حذف"}
    </button>
  );
}
