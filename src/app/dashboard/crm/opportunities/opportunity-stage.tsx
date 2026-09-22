"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type StageLite = { id: string; name: string; stage_type: string; required_fields: string[] };
type LostReason = { id: string; name: string; requires_note: boolean };

// ============================================================
// تغيير مرحلة الفرصة.
//
// القاعدة تفرض سبب الفشل عند الإغلاق كخسارة (sql/072). فبدل أن
// نرسل التحديث ونعرض خطأً أحمر، نسأل عن السبب **قبل** الإرسال حين
// تكون المرحلة المختارة من نوع «خسارة». الحارس في القاعدة يبقى
// الحَكَم؛ الواجهة تُحسن الظنّ به وتُجهّز ما سيطلبه.
// ============================================================
export default function OpportunityStage({
  id, stageId, stages, compact,
}: { id: string; stageId: string; stages: StageLite[]; compact?: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [askLost, setAskLost] = useState<string | null>(null);   // stage_id المطلوب
  const [reasons, setReasons] = useState<LostReason[]>([]);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");

  async function change(toId: string) {
    setErr(null);
    const target = stages.find((s) => s.id === toId);
    if (!target || toId === stageId) return;

    if (target.stage_type === "lost" || target.required_fields.includes("lost_reason_id")) {
      const { data } = await supabase
        .from("crm_lost_reasons").select("id,name,requires_note").eq("is_active", true).order("sort_order");
      setReasons((data ?? []) as LostReason[]);
      setAskLost(toId);
      return;
    }
    await save({ stage_id: toId });
  }

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    const { error } = await supabase.from("opportunities").update(patch).eq("id", id);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setAskLost(null);
    setReasonId("");
    setNote("");
    router.refresh();
  }

  const needsNote = reasons.find((r) => r.id === reasonId)?.requires_note ?? false;

  return (
    <div>
      <select
        value={stageId}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className={`rounded border border-gray-300 bg-white ${compact ? "w-full px-2 py-1 text-xs" : "px-2 py-1 text-sm"}`}
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      {askLost && (
        <div className="mt-2 space-y-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs">
          <p className="font-semibold text-red-800">سبب الخسارة — بلا الأسباب لا نعرف لماذا نخسر.</p>
          <select
            value={reasonId}
            onChange={(e) => setReasonId(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1"
          >
            <option value="">— اختر —</option>
            {reasons.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {needsNote && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="توضيح مطلوب لهذا السبب"
              className="w-full rounded border border-gray-300 px-2 py-1"
            />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!reasonId || (needsNote && !note.trim()) || busy}
              onClick={() => save({ stage_id: askLost, lost_reason_id: reasonId, lost_note: note.trim() || null })}
              className="rounded bg-red-700 px-3 py-1 font-semibold text-white disabled:opacity-50"
            >
              أغلق كخسارة
            </button>
            <button type="button" onClick={() => setAskLost(null)} className="rounded border border-gray-300 px-3 py-1 text-gray-600">
              إلغاء
            </button>
          </div>
        </div>
      )}

      {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
    </div>
  );
}
