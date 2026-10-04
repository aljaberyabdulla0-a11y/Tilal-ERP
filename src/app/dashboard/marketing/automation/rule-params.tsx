"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// معاملات القاعدة: أرقامٌ معروفة المفاتيح (pct · days · min_leads) لا JSON حرّ
const LABELS: Record<string, string> = { pct: "النسبة ٪", days: "الأيام", min_leads: "أدنى ليدات" };

export default function RuleParams({ id, params }: { id: string; params: Record<string, number> }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
  const [err, setErr] = useState<string | null>(null);
  if (Object.keys(params).length === 0) return <span className="text-xs text-gray-400">—</span>;

  async function save() {
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(vals)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return setErr(`${LABELS[k] ?? k}: رقم موجب`);
      next[k] = n;
    }
    const { error } = await createClient().from("mkt_automation_rules").update({ params: next }).eq("id", id);
    if (error) return setErr(error.message);
    setErr(null);
    router.refresh();
  }

  return (
    <span className="flex flex-wrap items-center gap-1 text-xs">
      {Object.keys(vals).map((k) => (
        <label key={k} className="flex items-center gap-1">{LABELS[k] ?? k}
          <input value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} dir="ltr" className="w-12 rounded border px-1 py-0.5" /></label>
      ))}
      <button type="button" onClick={save} className="text-brand-600">حفظ</button>
      {err && <span className="text-red-700">{err}</span>}
    </span>
  );
}
