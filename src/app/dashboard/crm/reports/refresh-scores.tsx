"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// إعادة حساب درجات الليدات يدوياً (تعمل تلقائياً كل يوم ٦ صباحاً
// بتوقيت بغداد — sql/074). لمن غيّر قواعد التقييم ولا يريد الانتظار.
export default function RefreshScores() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("refresh_lead_scores", { p_client_id: null });
    setBusy(false);
    if (error) {
      setMsg("تعذّر الحساب: " + error.message);
      return;
    }
    setMsg(`أُعيد الحساب — تغيّرت درجة ${data ?? 0} عميلاً.`);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={run}
        disabled={busy}
        title="تعمل تلقائياً كل يوم ٦ صباحاً — هذا الزر لتشغيلها الآن"
        className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3.5 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[18px]">thermostat</span>
        {busy ? "يحسب..." : "أعد حساب الدرجات"}
      </button>
      {msg && (
        <p className="absolute end-0 top-11 z-20 w-72 rounded-xl border bg-white p-3 text-xs text-gray-700 shadow-lg">
          {msg}
          <button onClick={() => setMsg(null)} className="ms-2 font-medium text-brand-600 hover:underline">
            إغلاق
          </button>
        </p>
      )}
    </div>
  );
}
