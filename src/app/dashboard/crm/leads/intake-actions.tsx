"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// معالجة صفّ من قائمة الأخطاء (lead_intake_resolve — 218).
// لا حذف: الإهمال يحتاج سبباً مكتوباً ويبقى الصفّ في الدفتر، فيُعرف بعد
// شهر لماذا لم يصر هذا الليد عميلاً.
// ============================================================
export default function IntakeActions({ id, status, phone, name }: {
  id: string; status: string; phone: string | null; name: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "fix" | "dismiss">("none");
  const [newPhone, setNewPhone] = useState(phone ?? "");
  const [newName, setNewName] = useState(name ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (action: "fix" | "retry" | "dismiss") => {
    setBusy(true);
    setMsg(null);
    const { data, error } = await createClient().rpc("lead_intake_resolve", {
      p_id: id, p_action: action,
      p_phone: action === "fix" ? newPhone : null,
      p_name: action === "fix" ? newName : null,
      p_note: action === "dismiss" ? note : null,
    });
    setBusy(false);
    if (error) return setMsg(error.message);
    const r = data as { status: string; reason: string | null };
    setMsg(r.status === "مُحوَّل" || r.status === "مكرّر" ? `تمّ: ${r.status}` : `${r.status}${r.reason ? ` — ${r.reason}` : ""}`);
    setMode("none");
    router.refresh();
  };

  return (
    <div className="space-y-1 text-xs">
      {mode === "none" && (
        <div className="flex flex-wrap gap-1">
          <button disabled={busy} onClick={() => setMode("fix")} className="rounded border px-2 py-1 hover:bg-gray-50">تصحيح الرقم</button>
          {status !== "مرفوض" && (
            <button disabled={busy} onClick={() => run("retry")} className="rounded border px-2 py-1 hover:bg-gray-50">أعد المحاولة</button>
          )}
          <button disabled={busy} onClick={() => setMode("dismiss")} className="rounded border px-2 py-1 text-gray-500 hover:bg-gray-50">إهمال</button>
        </div>
      )}
      {mode === "fix" && (
        <div className="flex flex-col gap-1">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="الاسم" className="rounded border px-2 py-1" />
          <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="07XXXXXXXXX" dir="ltr" className="rounded border px-2 py-1" />
          <div className="flex gap-1">
            <button disabled={busy || !newPhone.trim()} onClick={() => run("fix")} className="rounded bg-brand-600 px-2 py-1 text-white disabled:opacity-50">حفظ ومعالجة</button>
            <button onClick={() => setMode("none")} className="rounded border px-2 py-1">إلغاء</button>
          </div>
        </div>
      )}
      {mode === "dismiss" && (
        <div className="flex flex-col gap-1">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="السبب: رقم وهمي، اختبار، ليس عميلاً…" className="rounded border px-2 py-1" />
          <div className="flex gap-1">
            <button disabled={busy || !note.trim()} onClick={() => run("dismiss")} className="rounded bg-gray-700 px-2 py-1 text-white disabled:opacity-50">إهمال بسبب</button>
            <button onClick={() => setMode("none")} className="rounded border px-2 py-1">إلغاء</button>
          </div>
        </div>
      )}
      {msg && <p className="text-gray-600">{msg}</p>}
    </div>
  );
}
