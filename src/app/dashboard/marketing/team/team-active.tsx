"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function TeamActive({ employeeId, value }: { employeeId: string; value: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(value);
  async function flip() {
    const next = !v;
    setV(next);
    const { data, error } = await createClient().from("mkt_team").update({ is_active: next }).eq("employee_id", employeeId).select("employee_id");
    if (error || !data?.length) { setV(!next); return; }
    router.refresh();
  }
  return (
    <button type="button" onClick={flip} className={`rounded-full px-2 py-0.5 text-xs ${v ? "bg-brand-100 text-brand-700" : "bg-gray-100 text-gray-500"}`}>
      {v ? "فعّال" : "موقوف"}
    </button>
  );
}
