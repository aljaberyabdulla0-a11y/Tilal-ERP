"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MKT_ROLES } from "@/lib/marketing-style";

export default function TeamRole({ employeeId, value }: { employeeId: string; value: string }) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  async function change(next: string) {
    const prev = v;
    setV(next);
    const { data, error } = await createClient().from("mkt_team").update({ mkt_role: next }).eq("employee_id", employeeId).select("employee_id");
    if (error || !data?.length) { setV(prev); setErr(error?.message ?? "ليست من صلاحيتك."); return; }
    router.refresh();
  }
  return (
    <span className="inline-flex flex-col">
      <select value={v} onChange={(e) => change(e.target.value)} className="rounded border px-1.5 py-0.5 text-xs">
        {MKT_ROLES.map((r) => <option key={r}>{r}</option>)}
      </select>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}
