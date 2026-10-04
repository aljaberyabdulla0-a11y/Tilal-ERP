"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// قائمة تحقّق المهمّة (jsonb) — بنود الفعالية: حجز القاعة، الطباعة، الجناح…
export default function Checklist({ id, items, canEdit }: { id: string; items: { text: string; done: boolean }[]; canEdit: boolean }) {
  const [list, setList] = useState(items);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function save(next: { text: string; done: boolean }[]) {
    const prev = list;
    setList(next);
    const { error } = await createClient().from("mkt_tasks").update({ checklist: next }).eq("id", id);
    if (error) { setList(prev); setErr(error.message); }
  }

  if (!canEdit && list.length === 0) return null;
  const done = list.filter((i) => i.done).length;
  return (
    <div className="mt-1.5 border-t pt-1.5">
      {list.length > 0 && <p className="text-[10px] text-gray-400">{done}/{list.length}</p>}
      {list.map((it, i) => (
        <label key={i} className="flex items-center gap-1">
          <input type="checkbox" checked={it.done} disabled={!canEdit}
            onChange={() => save(list.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
          <span className={it.done ? "text-gray-400 line-through" : ""}>{it.text}</span>
        </label>
      ))}
      {canEdit && (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { save([...list, { text: text.trim(), done: false }]); setText(""); } }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="+ بند" className="mt-1 w-full rounded border border-gray-200 px-1 py-0.5" />
        </form>
      )}
      {err && <p className="text-red-600">{err}</p>}
    </div>
  );
}
