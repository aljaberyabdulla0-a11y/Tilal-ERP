"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/components/marketing/record-form";
import { fmt } from "@/lib/marketing-style";

// نسبة حركة 5700 قائمة إلى حملة — mkt_link_cash_move. لا حركة جديدة ولا قيد.
export default function LinkMove({
  moves, campaigns, channels, categories,
}: {
  moves: { id: string; move_date: string; amount: number; description: string | null }[];
  campaigns: { id: string; name: string }[];
  channels: { id: string; name: string }[];
  categories: string[];
}) {
  const router = useRouter();
  const [move, setMove] = useState(moves[0]?.id ?? "");
  const [category, setCategory] = useState(categories[0]);
  const [campaign, setCampaign] = useState("");
  const [channel, setChannel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function link() {
    setErr(null);
    if (!campaign && !channel) return setErr("اختر الحملة أو القناة — هي سبب الربط.");
    setBusy(true);
    const { error } = await createClient().rpc("mkt_link_cash_move", {
      p_cash_move: move, p_category: category, p_campaign: campaign || null, p_channel: channel || null,
      p_activity: null, p_vendor: null,
    });
    setBusy(false);
    if (error) return setErr(friendlyError(error.message, error.code));
    router.refresh();
  }

  const sel = "mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5";
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-5">
      <label className="sm:col-span-2"><span className="text-xs text-gray-500">الحركة</span>
        <select value={move} onChange={(e) => setMove(e.target.value)} className={sel}>
          {moves.map((m) => <option key={m.id} value={m.id}>{m.move_date} — {fmt(m.amount)} — {m.description ?? ""}</option>)}
        </select></label>
      <label><span className="text-xs text-gray-500">التصنيف</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={sel}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label><span className="text-xs text-gray-500">الحملة</span>
        <select value={campaign} onChange={(e) => setCampaign(e.target.value)} className={sel}><option value="">—</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label><span className="text-xs text-gray-500">القناة</span>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className={sel}><option value="">—</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {err && <p className="text-xs text-red-700 sm:col-span-5">{err}</p>}
      <div className="sm:col-span-5">
        <button type="button" disabled={busy || !move} onClick={link} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "…" : "اربط الحركة"}
        </button>
      </div>
    </div>
  );
}
