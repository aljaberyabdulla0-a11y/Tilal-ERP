"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// إنجاز مهمة تهيئة — complete_onboarding_task() (sql/151): HR أي مهمة،
// والمكلَّف مهمته. «غير لازمة» تطلب سبباً.
export default function OnboardingTaskButton({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(next: string) {
    let note: string | null = null;
    if (next === "غير لازمة") {
      note = prompt("لماذا غير لازمة؟");
      if (!note) return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("complete_onboarding_task", { p_id: id, p_status: next, p_note: note });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <span className="ms-auto flex items-center gap-1.5 text-xs">
      {status === "معلّقة" ? (
        <>
          <button disabled={busy} onClick={() => set("منجزة")}
            className="rounded bg-green-600 px-2 py-0.5 font-semibold text-white hover:bg-green-700 disabled:opacity-50">
            ✓ أُنجزت
          </button>
          <button disabled={busy} onClick={() => set("غير لازمة")} className="text-gray-400 hover:text-gray-600">غير لازمة</button>
        </>
      ) : (
        <button disabled={busy} onClick={() => set("معلّقة")} className="text-gray-400 hover:text-gray-600">إعادة فتح</button>
      )}
      {err && <span className="text-red-600">{err}</span>}
    </span>
  );
}
