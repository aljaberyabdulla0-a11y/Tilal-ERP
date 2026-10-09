"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/components/marketing/record-form";
import { DEFAULT_USD_RATE } from "@/lib/marketing-style";

// سعر الدولار للتكامل — mapping.usd_rate. مصروف ميتا يصل بعملة الحساب
// ويُحفظ بالدينار بهذا السعر. بلا قيمة تأخذ المزامنة الرسمي (1520).

export default function UsdRate({ id, mapping, canEdit }: {
  id: string; mapping: Record<string, unknown> | null; canEdit: boolean;
}) {
  const router = useRouter();
  const current = Number(mapping?.usd_rate ?? DEFAULT_USD_RATE);
  const [v, setV] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!canEdit) return <span dir="ltr" className="text-xs">{current.toLocaleString("en")}</span>;

  async function save() {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return setErr("رقمٌ موجب.");
    setErr(null);
    setBusy(true);
    const { data, error } = await createClient().from("mkt_integrations")
      .update({ mapping: { ...(mapping ?? {}), usd_rate: n } }).eq("id", id).select("id");
    setBusy(false);
    if (error || !data?.length) return setErr(error ? friendlyError(error.message, error.code) : "ليست من صلاحيتك.");
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col text-xs">
      <span className="flex items-center gap-1">
        <input type="number" dir="ltr" value={v} onChange={(e) => setV(e.target.value)}
          className="w-20 rounded border border-gray-300 px-1.5 py-0.5" />
        {Number(v) !== current && (
          <button type="button" disabled={busy} onClick={save} className="rounded border border-brand-600 px-1.5 py-0.5 text-brand-700 disabled:opacity-50">
            {busy ? "…" : "احفظ"}
          </button>
        )}
      </span>
      {err && <span className="mt-1 text-red-700">{err}</span>}
    </span>
  );
}
