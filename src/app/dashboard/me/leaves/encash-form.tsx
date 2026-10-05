"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// طلب صرف رصيد إجازة نقداً — request_leave_encashment (sql/157).
// القاعدة تتحقّق من الرصيد، والمبلغ يُحسب ويُجمَّد عند الاعتماد.
export default function EncashForm({ types }: { types: { id: string; name: string }[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(types[0]?.id ?? "");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (types.length === 0) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc("request_leave_encashment", {
      p_type: type, p_days: Number(days), p_reason: reason || null,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: "أُرسل الطلب إلى سلسلة الموافقة ✓" });
    setOpen(false);
    setDays("");
    setReason("");
    router.refresh();
  }

  return (
    <div>
      {!open && (
        <button onClick={() => setOpen(true)} className="text-sm text-brand-700 hover:underline">صرف جزء من الرصيد نقداً</button>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
      {open && (
        <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border bg-white p-4 text-sm">
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded border px-2 py-1.5">
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input type="number" min="0.5" step="0.5" dir="ltr" required placeholder="أيام" value={days}
            onChange={(e) => setDays(e.target.value)} className="w-24 rounded border px-2 py-1.5" />
          <input placeholder="السبب (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)}
            className="flex-1 rounded border px-2 py-1.5" />
          <button disabled={busy} className="rounded bg-brand-600 px-4 py-1.5 text-white disabled:opacity-50">إرسال</button>
          <button type="button" onClick={() => setOpen(false)} className="rounded border px-3 py-1.5">إلغاء</button>
        </form>
      )}
    </div>
  );
}
