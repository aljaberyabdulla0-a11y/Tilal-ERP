"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// مهلة طلب الحجز في المشروع (sql/128 project_broker_settings).
// الطلب المفتوح يقفل الوحدة؛ بلا مهلة قد يحجبها وسيطٌ بلا سقف.
export default function RequestTtl({ projectId, hours }: { projectId: string; hours: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(hours == null ? "" : String(hours));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const v = value.trim() ? Number(value) : null;
    const { error } = await createClient()
      .from("project_broker_settings")
      .upsert({ project_id: projectId, request_ttl_hours: v, updated_at: new Date().toISOString() });
    setBusy(false);
    setMsg(error ? error.message : "حُفظت — تسري على الطلبات الجديدة");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
      <span>مهلة طلب الحجز بلا قرار:</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="بلا انتهاء"
        className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
        dir="ltr"
      />
      <span>ساعة</span>
      <button onClick={save} disabled={busy} className="font-semibold text-brand-700 hover:underline disabled:opacity-50">
        حفظ
      </button>
      {msg && <span className="text-gray-500">{msg}</span>}
    </div>
  );
}
