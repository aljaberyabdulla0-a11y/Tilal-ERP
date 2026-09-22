"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// فعلان للمدير: فحص التكرار من جديد، وتطبيع المسافات.
//
// الفحص لا يحذف ولا يدمج — يرصد فقط (sql/071). والتطبيع هو الإصلاح
// الآلي الوحيد المسموح: «  أحمد   علي  » هو «أحمد علي» بلا خلاف
// (sql/077). كل ما عداه يمرّ بقرار بشري في اللوحة.
// ============================================================
export default function QualityActions({ whitespaceCount }: { whitespaceCount: number }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<"scan" | "ws" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function scan() {
    setBusy("scan");
    setMsg(null);
    const { data, error } = await supabase.rpc("scan_client_duplicates");
    setBusy(null);
    if (error) return setMsg({ kind: "err", text: error.message });
    setMsg({ kind: "ok", text: `اكتمل الفحص — ${data ?? 0} زوجاً بانتظار القرار.` });
    router.refresh();
  }

  async function fixWhitespace() {
    if (
      !confirm(
        `سيُطبَّع ${whitespaceCount} سجلاً: إزالة المسافات الزائدة من الاسم والمصدر والمنطقة. متابعة؟`
      )
    )
      return;
    setBusy("ws");
    setMsg(null);
    const { data, error } = await supabase.rpc("crm_fix_whitespace");
    setBusy(null);
    if (error) return setMsg({ kind: "err", text: error.message });
    setMsg({ kind: "ok", text: `طُبِّع ${data ?? 0} سجلاً.` });
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={scan}
          disabled={busy !== null}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition hover:border-brand-600 hover:text-brand-600 disabled:opacity-50"
        >
          {busy === "scan" ? "يفحص…" : "افحص التكرار"}
        </button>
        {whitespaceCount > 0 && (
          <button
            type="button"
            onClick={fixWhitespace}
            disabled={busy !== null}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition hover:border-brand-600 hover:text-brand-600 disabled:opacity-50"
          >
            {busy === "ws" ? "يطبّع…" : `طبّع المسافات (${whitespaceCount})`}
          </button>
        )}
      </div>
      {msg && (
        <p className={`text-xs ${msg.kind === "ok" ? "text-brand-700" : "text-red-700"}`}>{msg.text}</p>
      )}
    </div>
  );
}
