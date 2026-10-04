"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";
import LostSaleDialog from "@/components/lost-sale/lost-sale-dialog";
import ReactivateDialog from "@/components/lost-sale/reactivate-dialog";

type StageLite = { id: string; name: string; stage_type: string; required_fields: string[] };

// ============================================================
// تغيير مرحلة الفرصة.
//
// الإغلاق كخسارة لا يمرّ من هنا: القاعدة ترفض نقل الفرصة إلى مرحلة
// الخسارة إلا عبر close_opportunity_lost (140)، فنفتح نموذج «تحليل سبب
// فقدان فرصة البيع» بدل إرسال تحديث سيُرفض. والعودة من الخسارة إلى
// مرحلة مفتوحة تفتح «إعادة التنشيط» كي يُكتب سبب العودة وموعد الخطوة
// القادمة — والخسارة السابقة تبقى بتاريخها.
// ============================================================
export default function OpportunityStage({
  id, stageId, stages, compact,
}: { id: string; stageId: string; stages: StageLite[]; compact?: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const { v: tv } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"lost" | "reactivate" | null>(null);

  const current = stages.find((s) => s.id === stageId);

  async function change(toId: string) {
    setErr(null);
    const target = stages.find((s) => s.id === toId);
    if (!target || toId === stageId) return;

    if (target.stage_type === "lost") {
      setDialog("lost");
      return;
    }
    if (current?.stage_type === "lost" && target.stage_type === "open") {
      setDialog("reactivate");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("opportunities").update({ stage_id: toId }).eq("id", id);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <select
        value={stageId}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className={`rounded border border-gray-300 bg-white ${compact ? "w-full px-2 py-1 text-xs" : "px-2 py-1 text-sm"}`}
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{tv(s.name)}</option>
        ))}
      </select>

      {dialog === "lost" && (
        <LostSaleDialog opportunityId={id} onClose={() => setDialog(null)} onDone={() => router.refresh()} />
      )}
      {dialog === "reactivate" && (
        <ReactivateDialog opportunityId={id} onClose={() => setDialog(null)} onDone={() => router.refresh()} />
      )}

      {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
    </div>
  );
}
