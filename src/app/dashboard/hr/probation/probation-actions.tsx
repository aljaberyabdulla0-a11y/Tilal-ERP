"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ProbationRow } from "@/lib/recruitment";

// تقييم التجربة وقرارها — submit_probation_review / decide_probation (sql/151).
// القاعدة تحسم من يقيّم بأيّ صفة، وتمنع القرار قبل التقييمين.
export default function ProbationActions({ row, isHr }: { row: ProbationRow; isHr: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [panel, setPanel] = useState<"" | "review" | "decide">("");
  const [f, setF] = useState({
    type: isHr ? "HR" : "المدير",
    score: 0,
    recommendation: "",
    strengths: "",
    improvements: "",
    comments: "",
  });
  const [d, setD] = useState({ decision: "تثبيت", new_end: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function review(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("submit_probation_review", {
      p_employee: row.employee_id, p_type: f.type, p_score: f.score, p_recommendation: f.recommendation,
      p_strengths: f.strengths, p_improvements: f.improvements, p_comments: f.comments,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setPanel("");
    router.refresh();
  }

  async function decide(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("decide_probation", {
      p_employee: row.employee_id, p_decision: d.decision, p_new_end: d.new_end || null, p_note: d.note || null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setPanel("");
    router.refresh();
  }

  const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const pill = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "bg-brand-600 text-white" : "text-gray-600"}`;

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setPanel(panel === "review" ? "" : "review")} className="rounded-lg border px-3 py-1.5 text-sm text-brand-700 hover:bg-gray-50">
          تقييم
        </button>
        {row.can_decide && (
          <button onClick={() => setPanel(panel === "decide" ? "" : "decide")}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
            القرار
          </button>
        )}
      </div>
      {err && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{err}</p>}

      {panel === "review" && (
        <form onSubmit={review} className="mt-3 space-y-3 rounded-xl bg-gray-50 p-4">
          {isHr && (
            <div className="flex gap-2 text-sm">
              <span className="text-gray-600">بصفة:</span>
              {["HR", "المدير"].map((t) => (
                <button type="button" key={t} onClick={() => setF({ ...f, type: t })} className={pill(f.type === t)}>{t}</button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-600">الدرجة:</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button type="button" key={n} onClick={() => setF({ ...f, score: n })}
                className={`h-8 w-8 rounded-full border ${f.score === n ? "bg-brand-600 text-white" : "text-gray-600"}`}>{n}</button>
            ))}
            <span className="ms-3 text-gray-600">التوصية:</span>
            {["تثبيت", "تمديد", "إنهاء"].map((r) => (
              <button type="button" key={r} onClick={() => setF({ ...f, recommendation: r })} className={pill(f.recommendation === r)}>{r}</button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <textarea className={input} rows={2} placeholder="نقاط القوة" value={f.strengths} onChange={(e) => setF({ ...f, strengths: e.target.value })} />
            <textarea className={input} rows={2} placeholder="ما يحتاج تحسيناً" value={f.improvements} onChange={(e) => setF({ ...f, improvements: e.target.value })} />
            <textarea className={input} rows={2} placeholder="ملاحظات" value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} />
          </div>
          <button disabled={busy || !f.score || !f.recommendation}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">حفظ التقييم</button>
        </form>
      )}

      {panel === "decide" && (
        <form onSubmit={decide} className="mt-3 space-y-3 rounded-xl bg-gray-50 p-4">
          <div className="flex gap-2 text-sm">
            {["تثبيت", "تمديد", "إنهاء"].map((r) => (
              <button type="button" key={r} onClick={() => setD({ ...d, decision: r })} className={pill(d.decision === r)}>{r}</button>
            ))}
          </div>
          {d.decision === "تمديد" && (
            <label className="block text-xs text-gray-600">
              نهاية التجربة الجديدة *
              <input className={input} type="date" dir="ltr" required min={row.probation_end} value={d.new_end}
                onChange={(e) => setD({ ...d, new_end: e.target.value })} />
            </label>
          )}
          <textarea className={input} rows={2} required={d.decision === "إنهاء"}
            placeholder={d.decision === "إنهاء" ? "سبب الإنهاء (إلزامي)" : "ملاحظة"}
            value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} />
          {d.decision === "إنهاء" && (
            <p className="text-xs text-amber-700">يُسجَّل القرار ويُنبَّه المدير لإكمال «إنهاء الخدمة» (التسليم وإغلاق الحساب) من ملف الموظف.</p>
          )}
          <button disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">تأكيد القرار</button>
        </form>
      )}
    </div>
  );
}
