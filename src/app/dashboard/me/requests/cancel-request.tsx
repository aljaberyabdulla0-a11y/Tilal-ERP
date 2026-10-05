"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// سحب طلبٍ لم يُقرَّر بعد — cancel_approval (sql/153)
export default function CancelRequest({ approvalId }: { approvalId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!confirm("سحب الطلب؟")) return;
    setBusy(true);
    const { error } = await supabase.rpc("cancel_approval", { p_request: approvalId, p_note: "سحبه صاحبه" });
    setBusy(false);
    if (error) return alert(error.message);
    router.refresh();
  }

  return (
    <button disabled={busy} onClick={cancel} className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50">سحب</button>
  );
}
