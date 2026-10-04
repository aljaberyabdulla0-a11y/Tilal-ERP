"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/client";
import { lostDict, type Lang } from "@/lib/lost-sales-i18n";

// ============================================================
// إعادة تنشيط فرصة خاسرة (reactivate_lost_opportunity — 140).
//
// الخسارة لا تُمحى: صفّها يصير «أُعيد تنشيطها» بسببه وتاريخه، فإن
// رُبحت الفرصة صارت «مسترجعة» بقيمتها في تقرير المبيعات المسترجعة.
// والفرصة العائدة تحتاج خطوة قادمة بموعد — وإلا عادت لتُنسى.
// ============================================================
export default function ReactivateDialog({
  opportunityId,
  onClose,
  onDone,
}: {
  opportunityId: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const supabase = createClient();
  const { locale, dir, v: tv } = useI18n();
  const lang = locale as Lang;
  const t = lostDict(lang);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" });

  const [stages, setStages] = useState<{ id: string; name: string }[]>([]);
  const [stageId, setStageId] = useState("");
  const [note, setNote] = useState("");
  const [next, setNext] = useState("");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("crm_stages")
      .select("id, name, sort_order")
      .eq("stage_type", "open")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        const s = (data ?? []) as { id: string; name: string }[];
        setStages(s);
        // الافتراض: «اتصال» — العميل عاد فنتواصل معه أولاً
        setStageId(s[1]?.id ?? s[0]?.id ?? "");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("reactivate_lost_opportunity", {
      p_opportunity_id: opportunityId,
      p_stage_id: stageId,
      p_note: note.trim(),
      p_next_action: next.trim() || null,
      p_next_action_date: date,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    onDone?.();
    onClose();
  }

  const input = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none";
  const ok = stageId && note.trim() && date && date >= today;

  return (
    <div dir={dir} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
         role="dialog" aria-modal="true" aria-labelledby="react-title"
         onKeyDown={(e) => { if (e.key === "Escape" && !busy) onClose(); }}>
      <div className="w-full max-w-lg overflow-hidden rounded-t-2xl bg-white text-start shadow-xl sm:rounded-2xl">
        <header className="border-b bg-emerald-50 px-5 py-4">
          <h2 id="react-title" className="flex items-center gap-2 text-lg font-bold text-emerald-800">
            <span className="material-symbols-outlined">restart_alt</span>
            {t.reactivate}
          </h2>
          <p className="mt-1 text-xs text-emerald-900/70">{t.reactivateIntro}</p>
        </header>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600" htmlFor="ra-stage">{t.reactivateStage}</label>
            <select id="ra-stage" value={stageId} onChange={(e) => setStageId(e.target.value)} className={input}>
              {stages.map((s) => <option key={s.id} value={s.id}>{tv(s.name)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-600" htmlFor="ra-note">{t.reactivateNote} *</label>
            <textarea id="ra-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600" htmlFor="ra-next">{t.nextAction}</label>
              <input id="ra-next" value={next} onChange={(e) => setNext(e.target.value)} className={input} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600" htmlFor="ra-date">{t.nextActionDate} *</label>
              <input id="ra-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} className={input} dir="ltr" />
            </div>
          </div>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t bg-gray-50 px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700">
            {t.cancel}
          </button>
          <button type="button" onClick={submit} disabled={busy || !ok}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
            {busy ? t.saving : t.reactivateSave}
          </button>
        </footer>
      </div>
    </div>
  );
}
