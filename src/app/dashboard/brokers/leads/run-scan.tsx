"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// زرّ فحص المهل يدوياً — نفس ما يفعله الفحص اليومي التلقائي
// (٩:٠٥ صباحاً بتوقيت بغداد)، لمن لا يريد انتظار الغد.
export default function RunScan() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("run_broker_lead_scan");
    setBusy(false);

    if (error) {
      setMsg("تعذّر الفحص: " + error.message);
      return;
    }
    const n = Number(data ?? 0);
    setMsg(n > 0 ? `عاد ${n} ليداً إلى تلال.` : "لا ليدات انتهت مهلتها.");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100 disabled:opacity-50"
      >
        {busy ? "جارٍ الفحص..." : "فحص المهل الآن"}
      </button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </div>
  );
}
