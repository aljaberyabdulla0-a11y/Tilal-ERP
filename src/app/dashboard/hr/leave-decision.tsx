"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// أزرار الموافقة/الرفض على طلب إجازة (للمدير)
export default function LeaveDecision({ leaveId }: { leaveId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function decide(status: "موافق عليها" | "مرفوضة") {
    setBusy(true);
    const { error } = await supabase
      .from("leaves")
      .update({ status })
      .eq("id", leaveId);
    setBusy(false);
    if (error) {
      alert("تعذّر التحديث: " + error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => decide("موافق عليها")}
        disabled={busy}
        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
      >
        موافقة
      </button>
      <button
        onClick={() => decide("مرفوضة")}
        disabled={busy}
        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
      >
        رفض
      </button>
    </div>
  );
}
