"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// «زامن الآن» و«اشترك الصفحة» — ينادي دالّة الحافة marketing-sync بجلسة
// المستخدم. الدالّة تتحقّق من الصلاحية وتقرأ المفتاح بنفسها.
export default function SyncNow({ integrationId, mode = "manual", label = "زامن الآن" }: {
  integrationId: string; mode?: "manual" | "subscribe_page"; label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const { data, error } = await createClient().functions.invoke("marketing-sync", {
      body: { mode, integration_id: integrationId },
    });
    setBusy(false);
    if (error) {
      // رسالة الدالّة في جسم الردّ لا في error.message («non-2xx status code»)
      const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
      setMsg(`فشل: ${body?.error ?? body?.message ?? error.message}`);
    } else setMsg((data as { message?: string })?.message ?? "تمّ");
    router.refresh();
  }

  return (
    <span className="flex flex-col text-xs">
      <button type="button" disabled={busy} onClick={run} className="rounded border border-brand-600 px-2 py-0.5 text-brand-700 disabled:opacity-50">
        {busy ? "…" : label}
      </button>
      {msg && <span className="mt-1 max-w-[12rem]">{msg}</span>}
    </span>
  );
}
