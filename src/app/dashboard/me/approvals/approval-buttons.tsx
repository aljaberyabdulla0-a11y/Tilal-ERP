"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// قرار في خطوةٍ من سلسلة — approval_decide (sql/153). الرفض بسبب.
export default function ApprovalButtons({ requestId }: { requestId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function decide(approve: boolean) {
    const note = approve ? prompt("ملاحظة (اختياري):") ?? "" : prompt("سبب الرفض:");
    if (!approve && !note) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("approval_decide", {
      p_request: requestId, p_approve: approve, p_note: note || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => decide(true)}
          className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
          موافقة
        </button>
        <button disabled={busy} onClick={() => decide(false)}
          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
          رفض
        </button>
      </div>
      {err && <span className="max-w-xs text-xs text-red-600">{err}</span>}
    </div>
  );
}
