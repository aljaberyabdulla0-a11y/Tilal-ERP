"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// استثناء إداري موثَّق: إتاحة صرف عمولة وسيط قبل قاعدة خطّتها
// (sql/129 release_broker_commission — السبب يُكتب على العمولة)
export default function ReleaseCommission({ commissionId }: { commissionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function release() {
    const reason = prompt("سبب إتاحة الصرف قبل قاعدة الخطة (يُسجَّل على العمولة):");
    if (!reason?.trim()) return;
    setBusy(true);
    const { error } = await createClient().rpc("release_broker_commission", {
      p_comm: commissionId,
      p_reason: reason,
    });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <button onClick={release} disabled={busy} className="text-[11px] text-gray-500 hover:text-brand-700 hover:underline disabled:opacity-50">
      إتاحة الصرف استثناءً
    </button>
  );
}
