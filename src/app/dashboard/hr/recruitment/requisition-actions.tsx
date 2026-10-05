"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// قرار على طلب التوظيف: HR في مرحلتها، والمدير في مرحلة الإدارة.
// لا أحد يقرّر في طلبه — والقاعدة ترفضه أيضاً (decide_requisition).
export default function RequisitionActions({
  id,
  status,
  mine,
  canHr,
  canMgmt,
  canCancel,
}: {
  id: string;
  status: string;
  mine: boolean;
  canHr: boolean;
  canMgmt: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const myStage = !mine && ((status === "بانتظار HR" && canHr) || (status === "بانتظار الإدارة" && canMgmt));
  const cancellable = canCancel && (status === "بانتظار HR" || status === "بانتظار الإدارة");
  if (!myStage && !cancellable) return null;

  async function decide(approve: boolean) {
    const note = approve ? prompt("ملاحظة (اختياري):") ?? "" : prompt("سبب الرفض:");
    if (!approve && !note) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("decide_requisition", { p_id: id, p_approve: approve, p_note: note || null });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  async function cancel() {
    if (!confirm("إلغاء طلب التوظيف؟")) return;
    setBusy(true);
    const { error } = await supabase.rpc("cancel_requisition", { p_id: id, p_note: null });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      {myStage && (
        <div className="flex gap-1.5">
          <button disabled={busy} onClick={() => decide(true)}
            className="rounded bg-green-600 px-2.5 py-1 font-semibold text-white hover:bg-green-700 disabled:opacity-50">
            {status === "بانتظار HR" ? "موافقة HR" : "اعتماد"}
          </button>
          <button disabled={busy} onClick={() => decide(false)}
            className="rounded border border-red-300 px-2.5 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50">
            رفض
          </button>
        </div>
      )}
      {cancellable && (
        <button disabled={busy} onClick={cancel} className="text-gray-400 hover:text-red-600">إلغاء الطلب</button>
      )}
      {err && <span className="max-w-[12rem] text-red-600">{err}</span>}
    </div>
  );
}
