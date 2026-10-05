"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// أزرار الموافقة/الرفض على طلب إجازة.
//
// القرار عبر decide_leave (sql/155): إن كانت للإجازة سلسلة موافقة مفتوحة
// يمرّ بمحرّك الموافقات (المدير المباشر ← HR …) — فيُقبل ممن عليه الدور
// الآن، ويُسجَّل. والطلبات القديمة بلا سلسلة تُقرَّر بالقاعدة القديمة.
// التحديث المباشر للحالة صار مرفوضاً لغير HR والمدير.
export default function LeaveDecision({ leaveId }: { leaveId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function decide(approve: boolean) {
    let note: string | null = null;
    if (!approve) {
      note = prompt("سبب الرفض:");
      if (!note) return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("decide_leave", {
      p_leave: leaveId,
      p_approve: approve,
      p_note: note,
    });
    setBusy(false);
    if (error) {
      alert("تعذّر القرار: " + error.message);
      return;
    }
    if (data === "قيد الموافقة") {
      alert("سُجّلت موافقتك — انتقل الطلب إلى المرحلة التالية من سلسلة الموافقة.");
    }
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => decide(true)}
        disabled={busy}
        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
      >
        موافقة
      </button>
      <button
        onClick={() => decide(false)}
        disabled={busy}
        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
      >
        رفض
      </button>
    </div>
  );
}
