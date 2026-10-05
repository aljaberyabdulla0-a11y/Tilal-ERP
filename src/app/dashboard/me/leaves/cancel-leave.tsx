"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// سحب طلب إجازة معلّق — cancel_my_leave (sql/155) تُغلق سلسلته أيضاً
export default function CancelLeave({ leaveId }: { leaveId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!confirm("سحب طلب الإجازة؟")) return;
    setBusy(true);
    const { error } = await supabase.rpc("cancel_my_leave", { p_leave: leaveId });
    setBusy(false);
    if (error) return alert(error.message);
    router.refresh();
  }

  return (
    <button disabled={busy} onClick={cancel} className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50">
      سحب
    </button>
  );
}
