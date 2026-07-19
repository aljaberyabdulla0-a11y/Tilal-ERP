"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// زر حذف صف من جدول مصاريف/تسويات الشركاء
export default function DeleteRowButton({
  table,
  id,
}: {
  table: "partner_expenses" | "partner_settlements";
  id: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!window.confirm("حذف هذا السجل؟")) return;
    setBusy(true);
    const { error } = await supabase.from(table).delete().eq("id", id);
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
