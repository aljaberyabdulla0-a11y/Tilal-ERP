"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// إجابة سؤال تلال عن الطلب — تعيده لمن سأل (sql/128 broker_request_answer)
export default function AnswerInfo({ id, question }: { id: string; question: string | null }) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("broker_request_answer", { p_id: id, p_answer: answer });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setAnswer("");
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl bg-purple-50 p-3">
      <p className="text-sm text-purple-900">
        <b>تلال تسأل:</b> {question ?? "—"}
      </p>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={2}
        placeholder="إجابتكم"
        className="w-full rounded-lg border border-purple-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={send}
        disabled={busy || !answer.trim()}
        className="rounded-lg bg-purple-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
      >
        {busy ? "..." : "إرسال الإجابة"}
      </button>
    </div>
  );
}
