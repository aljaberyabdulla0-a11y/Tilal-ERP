"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// التقييم الذاتي — submit_review_step(…, 'ذاتي') (sql/160)
export default function SelfReview({ reviewId, label }: { reviewId: string; label: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [score, setScore] = useState(0);
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("submit_review_step", {
      p_review: reviewId, p_step: "ذاتي", p_score: score, p_comments: comments, p_recommendation: null,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
      <p className="font-semibold text-amber-900">قيّم أداءك — {label}</p>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span>الدرجة:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setScore(n)}
            className={`h-8 w-8 rounded-full border ${score === n ? "bg-brand-600 text-white" : "bg-white text-gray-600"}`}>{n}</button>
        ))}
      </div>
      <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2}
        placeholder="ما أنجزته، وما تحتاجه للتحسّن…" className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <button disabled={busy || !score} onClick={submit}
        className="mt-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
        إرسال إلى المدير
      </button>
    </div>
  );
}
