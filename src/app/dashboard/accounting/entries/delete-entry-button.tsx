"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// زر حذف قيد يومية (تُحذف سطوره تلقائياً عبر cascade)
export default function DeleteEntryButton({ id }: { id: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm("هل أنت متأكد من حذف هذا القيد؟")) return;
    setDeleting(true);
    const { error } = await supabase.from("journal_entries").delete().eq("id", id);
    setDeleting(false);
    if (error) {
      alert("تعذّر الحذف: " + error.message);
      return;
    }
    router.push("/dashboard/accounting/entries");
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
