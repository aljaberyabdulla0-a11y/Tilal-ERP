"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MyInterview } from "@/lib/recruitment";

// تقييم المقيِّم: درجة 1–5 وتوصية وملاحظات — مرةً واحدة
// (submit_interview_feedback ترفض إعادة الكتابة).
export default function InterviewFeedback({ interview }: { interview: MyInterview }) {
  const router = useRouter();
  const supabase = createClient();
  const [score, setScore] = useState(0);
  const [reco, setReco] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function openCv() {
    // السيرة تُقرأ بسياسة التخزين: المقيِّم يرى سيرة من يقابله فقط
    const { data: c } = await supabase.from("candidates").select("cv_path").eq("id", interview.candidate_id).maybeSingle();
    const path = (c as { cv_path: string | null } | null)?.cv_path;
    if (!path) return setErr("لا سيرة مرفوعة.");
    const { data, error } = await supabase.storage.from("recruitment").createSignedUrl(path, 60);
    if (error || !data) return setErr("تعذّر فتح السيرة: " + (error?.message ?? ""));
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("submit_interview_feedback", {
      p_id: interview.id, p_score: score, p_recommendation: reco, p_feedback: feedback,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="mt-3 border-t pt-3">
      {interview.has_cv && (
        <button onClick={openCv} className="mb-2 text-xs text-brand-700 hover:underline">السيرة الذاتية</button>
      )}
      {err && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{err}</p>}
      {interview.status === "تمت" ? (
        <p className="text-sm text-gray-700">
          قيّمتها: <b>{interview.score}/5</b> — {interview.recommendation}
          {interview.feedback && <span className="block text-xs text-gray-500">{interview.feedback}</span>}
        </p>
      ) : interview.status === "ألغيت" ? (
        <p className="text-sm text-gray-400">أُلغيت المقابلة.</p>
      ) : (
        <form onSubmit={save} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-600">الدرجة:</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button type="button" key={n} onClick={() => setScore(n)}
                className={`h-8 w-8 rounded-full border text-sm ${score === n ? "bg-brand-600 text-white" : "text-gray-600"}`}>
                {n}
              </button>
            ))}
            <span className="ms-3 text-gray-600">التوصية:</span>
            {["قبول", "محايد", "رفض"].map((r) => (
              <button type="button" key={r} onClick={() => setReco(r)}
                className={`rounded-full border px-3 py-1 text-xs ${reco === r ? "bg-brand-600 text-white" : "text-gray-600"}`}>
                {r}
              </button>
            ))}
          </div>
          <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2}
            placeholder="نقاط القوة والضعف…" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <button disabled={busy || !score || !reco}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            إرسال التقييم
          </button>
        </form>
      )}
    </div>
  );
}
