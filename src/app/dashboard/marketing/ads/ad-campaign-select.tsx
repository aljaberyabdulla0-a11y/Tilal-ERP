"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/components/marketing/record-form";

// ربط «حملة إعلانية» بحملة تلال. الوراثة في القاعدة (mkt_stamp_ad_object)
// عند الإدخال وحده، والمقاييس على مستوى الإعلان — فالتغيير يسري هنا على
// المجموعات والإعلانات تحتها، وإلا بقيت مصروفاتها على الحملة القديمة.
export default function AdCampaignSelect({ id, value, campaigns }: {
  id: string; value: string | null; campaigns: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [v, setV] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function change(next: string) {
    const prev = v;
    setV(next);
    setErr(null);
    setBusy(true);
    const supabase = createClient();
    const campaign_id = next || null;
    const fail = (e: { message: string; code?: string } | null) => {
      setBusy(false);
      setV(prev);
      setErr(e ? friendlyError(e.message, e.code) : "ليست من صلاحيتك.");
    };

    const top = await supabase.from("mkt_ad_objects").update({ campaign_id }).eq("id", id).select("id");
    if (top.error || !top.data?.length) return fail(top.error);
    const sets = await supabase.from("mkt_ad_objects").update({ campaign_id }).eq("parent_id", id).select("id");
    if (sets.error) return fail(sets.error);
    const setIds = (sets.data ?? []).map((s) => s.id);
    if (setIds.length) {
      const ads = await supabase.from("mkt_ad_objects").update({ campaign_id }).in("parent_id", setIds).select("id");
      if (ads.error) return fail(ads.error);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col">
      <select value={v} disabled={busy} onChange={(e) => change(e.target.value)}
        className="max-w-[11rem] rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-brand-700">
        <option value="">بلا حملة</option>
        {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {err && <span className="mt-1 max-w-xs text-xs text-red-700">{err}</span>}
    </span>
  );
}
