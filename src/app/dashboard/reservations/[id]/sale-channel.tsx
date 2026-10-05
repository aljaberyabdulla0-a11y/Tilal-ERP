"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// تغيير قناة البيع (sql/128 set_sale_channel) — للمدير، وقبل اكتمال البيع
// فقط: بعده تكون العمولات قد دخلت دلوين وربما دفعات، فالتصحيح فسخٌ ثم
// إعادة. القناة تُختم في القاعدة عند الحجز، وهذا التصحيح موثَّق بسببه.
// ============================================================
export default function SaleChannelSwitch({
  reservationId,
  channel,
  companyId,
  companies,
}: {
  reservationId: string;
  channel: string;
  companyId: string | null;
  companies: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState(channel === "وسيط" ? "مباشر" : "وسيط");
  const [company, setCompany] = useState(companyId ?? companies[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("set_sale_channel", {
      p_res: reservationId,
      p_channel: next,
      p_company: next === "وسيط" ? company : null,
      p_reason: reason,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ms-2 text-xs text-brand-700 hover:underline">
        تغيير
      </button>
    );
  }

  const cls = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm";
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-gray-50 p-3">
      <div className="flex flex-wrap gap-2">
        <select value={next} onChange={(e) => setNext(e.target.value)} className={cls}>
          <option>مباشر</option>
          <option>وسيط</option>
        </select>
        {next === "وسيط" && (
          <select value={company} onChange={(e) => setCompany(e.target.value)} className={cls}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="السبب (إلزامي)" className={cls + " w-full"} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy || !reason.trim()} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? "..." : "حفظ"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-500">إلغاء</button>
      </div>
    </div>
  );
}
