"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// الاستقالة — submit_termination(…, 'استقالة') (sql/163). تمرّ بسلسلة
// «termination» ثم إخلاء الطرف والتسوية.
export default function ResignForm({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm("تقديم الاستقالة؟ تمرّ بموافقة المدير وHR والإدارة.")) return;
    setBusy(true);
    const { error } = await supabase.rpc("submit_termination", {
      p_employee: employeeId, p_type: "استقالة", p_last_day: day, p_reason: reason, p_successor: null,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: "أُرسلت الاستقالة ✓" });
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="text-sm">
      {!open && <button onClick={() => setOpen(true)} className="text-gray-400 hover:text-red-600">تقديم استقالة</button>}
      {msg && <p className={`mt-1 ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
      {open && (
        <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-red-200 bg-white p-4">
          <label className="text-xs text-gray-600">آخر يوم عمل<input type="date" dir="ltr" required value={day} onChange={(e) => setDay(e.target.value)} className="block rounded border px-2 py-1.5" /></label>
          <input required placeholder="السبب" value={reason} onChange={(e) => setReason(e.target.value)} className="flex-1 rounded border px-2 py-1.5" />
          <button disabled={busy} className="rounded bg-red-600 px-4 py-1.5 text-white disabled:opacity-50">إرسال</button>
          <button type="button" onClick={() => setOpen(false)} className="rounded border px-3 py-1.5">إلغاء</button>
        </form>
      )}
    </div>
  );
}
