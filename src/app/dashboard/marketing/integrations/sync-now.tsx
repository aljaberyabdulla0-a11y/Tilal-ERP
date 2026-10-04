"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// «زامن الآن» — ينادي دالّة الحافة marketing-sync بجلسة المستخدم.
// الدالّة تتحقّق من الصلاحية (mkt_sync_begin) وتقرأ المفتاح بنفسها.
export default function SyncNow({ integrationId }: { integrationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const { data, error } = await createClient().functions.invoke("marketing-sync", {
      body: { mode: "manual", integration_id: integrationId },
    });
    setBusy(false);
    if (error) setMsg(`فشل: ${error.message}`);
    else setMsg((data as { message?: string })?.message ?? "تمّ");
    router.refresh();
  }

  return (
    <span className="flex flex-col text-xs">
      <button type="button" disabled={busy} onClick={run} className="rounded border border-brand-600 px-2 py-0.5 text-brand-700 disabled:opacity-50">
        {busy ? "يزامن…" : "زامن الآن"}
      </button>
      {msg && <span className="mt-1 max-w-[12rem]">{msg}</span>}
    </span>
  );
}
