"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// سحب طلب مفتوح — يُحرّر الوحدة لغيركم
export default function CancelRequest({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!confirm("سحب الطلب؟ تعود الوحدة متاحة لغيركم.")) return;
    setBusy(true);
    const { error } = await createClient().rpc("broker_cancel_reservation_request", { p_id: id });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <button
      onClick={cancel}
      disabled={busy}
      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
    >
      سحب الطلب
    </button>
  );
}
