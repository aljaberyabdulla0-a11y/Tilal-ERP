"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";
import LostSaleDialog from "@/components/lost-sale/lost-sale-dialog";
import ReactivateDialog from "@/components/lost-sale/reactivate-dialog";
import { moveClientStage, stageMoveIntent, type StageRule } from "@/lib/crm-journey";

type StageLite = { id: string; name: string; stage_type: string; requires_reason?: boolean; is_manual?: boolean };

// ============================================================
// تغيير مرحلة مسارٍ بعينه — لعميلٍ له أكثر من مسار (شراء ثانٍ).
// المسار الحالي يُنقل من شريط الحالة أعلى الملفّ؛ هذا للمسار المحدَّد.
// الباب نفسه (crm_move_client_stage مع p_journey_id) والقواعد نفسها.
// ============================================================
export default function JourneyStage({
  clientId, journeyId, stageId, stages, isAdmin = false,
}: { clientId: string; journeyId: string; stageId: string; stages: StageLite[]; isAdmin?: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const { v: tv } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"lost" | "reactivate" | null>(null);
  const [askReason, setAskReason] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const rule = (s: StageLite | undefined): StageRule | undefined =>
    s && { name: s.name, type: s.stage_type as StageRule["type"], requiresReason: s.requires_reason, manual: s.is_manual };
  const current = stages.find((s) => s.id === stageId);

  async function send(toName: string, why?: string) {
    setBusy(true);
    setErr(null);
    const r = await moveClientStage(supabase, clientId, toName, why, journeyId);
    setBusy(false);
    if (!r.ok) {
      if (r.hint === "stage_reason") return setAskReason(toName);
      return setErr(r.message);
    }
    setAskReason(null);
    setReason("");
    router.refresh();
  }

  async function change(toId: string) {
    const target = stages.find((s) => s.id === toId);
    if (!target || toId === stageId) return;
    const intent = stageMoveIntent(rule(current), rule(target)!, { isAdmin });
    if (intent === "lost_form") return setDialog("lost");
    if (intent === "reactivate") return setDialog("reactivate");
    if (intent === "reason") return setAskReason(target.name);
    if (intent === "reservation") return setErr(`«${target.name}» يدخلها المسار بتسجيل الحجز من تبويب العقار.`);
    if (intent === "won_locked") return setErr("المسار رابح — لشراءٍ جديد افتح «مسار شراء إضافي».");
    await send(target.name);
  }

  return (
    <div>
      <select
        value={stageId}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{tv(s.name)}{s.is_manual === false ? " (بالحجز)" : ""}</option>
        ))}
      </select>

      {askReason && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`سبب النقل إلى «${askReason}»`}
            className="w-64 rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={reason.trim().length < 5 || busy}
            onClick={() => send(askReason, reason)}
            className="rounded bg-brand-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50"
          >
            انقل
          </button>
          <button type="button" onClick={() => { setAskReason(null); setReason(""); }} className="text-sm text-gray-500">
            إلغاء
          </button>
        </div>
      )}

      {dialog === "lost" && (
        <LostSaleDialog opportunityId={journeyId} onClose={() => setDialog(null)} onDone={() => router.refresh()} />
      )}
      {dialog === "reactivate" && (
        <ReactivateDialog opportunityId={journeyId} onClose={() => setDialog(null)} onDone={() => router.refresh()} />
      )}

      {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
    </div>
  );
}
