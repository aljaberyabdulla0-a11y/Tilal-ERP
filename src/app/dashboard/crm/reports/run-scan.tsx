"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type ScanResult = {
  due_today: number;
  overdue: number;
  escalated: number;
  admins_notified: number;
};

// تشغيل فحص المتابعات يدوياً (يعمل تلقائياً كل يوم ٩ صباحاً بتوقيت بغداد)
export default function RunFollowupScan() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("run_crm_followup_scan");
    setBusy(false);

    if (error) {
      setMsg("تعذّر الفحص: " + error.message);
      return;
    }
    const r = data as ScanResult;
    setMsg(
      `تم الفحص: ${r.due_today} موعدها اليوم · ${r.overdue} متأخرة · ` +
        (r.escalated > 0
          ? `${r.escalated} صُعّدت للإدارة`
          : "لا يوجد ما يستدعي التصعيد")
    );
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={run}
        disabled={busy}
        title="يعمل تلقائياً كل يوم ٩ صباحاً — هذا الزر لتشغيله الآن"
        className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3.5 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[18px]">notifications_active</span>
        {busy ? "جاري الفحص..." : "فحص المتابعات الآن"}
      </button>

      {msg && (
        <p className="absolute end-0 top-11 z-20 w-72 rounded-xl border bg-white p-3 text-xs text-gray-700 shadow-lg">
          {msg}
          <button
            onClick={() => setMsg(null)}
            className="ms-2 font-medium text-brand-600 hover:underline"
          >
            إغلاق
          </button>
        </p>
      )}
    </div>
  );
}
