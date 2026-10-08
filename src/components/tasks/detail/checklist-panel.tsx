"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyTaskError } from "@/lib/tasks";
import type { TaskChecklistItem } from "@/lib/types";

// ============================================================
// قائمة التحقق — كتابة مباشرة على task_checklist_items (RLS: من يعدّل
// المهمة). التعليم متفائل: يتحوّل فوراً ويعود إن رفضت القاعدة.
// المحفّز يسجّل من أنجز البند ومتى، ويكتب في سجلّ المهمة.
// ============================================================
export default function ChecklistPanel({
  taskId, items, canEdit,
}: { taskId: string; items: TaskChecklistItem[]; canEdit: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [list, setList] = useState(items);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setList(items), [items]);

  const done = list.filter((i) => i.is_done).length;

  async function toggle(i: TaskChecklistItem) {
    const before = list;
    setList((l) => l.map((x) => (x.id === i.id ? { ...x, is_done: !x.is_done } : x)));
    const { error } = await supabase.from("task_checklist_items").update({ is_done: !i.is_done }).eq("id", i.id);
    if (error) {
      console.error(error);
      setList(before);
      setErr(friendlyTaskError(error));
    } else router.refresh();
  }

  async function add() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const { error } = await supabase.from("task_checklist_items").insert({ task_id: taskId, body });
    setBusy(false);
    if (error) {
      console.error(error);
      return setErr(friendlyTaskError(error));
    }
    setText("");
    router.refresh();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("task_checklist_items").delete().eq("id", id);
    if (error) return setErr(friendlyTaskError(error));
    router.refresh();
  }

  if (!list.length && !canEdit) return null;

  return (
    <section className="dash-card p-4" aria-label="قائمة التحقق">
      <h2 className="mb-2 flex items-center justify-between font-bold text-ink">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined">checklist</span>
          قائمة التحقق
        </span>
        {list.length > 0 && <span className="text-xs font-normal text-gray-500" dir="ltr">{done}/{list.length}</span>}
      </h2>
      {list.length > 0 && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(100 * done) / list.length}%` }} />
        </div>
      )}
      <ul className="space-y-1">
        {list.map((i) => (
          <li key={i.id} className="group flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-surface-subtle">
            <input type="checkbox" checked={i.is_done} onChange={() => toggle(i)} disabled={!canEdit}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600" aria-label={i.body} />
            <span className={`flex-1 text-sm ${i.is_done ? "text-gray-400 line-through" : "text-ink"}`}>
              {i.body}
              {i.is_done && i.done_by_name && <span className="ms-2 text-[11px] text-gray-400 no-underline">— {i.done_by_name}</span>}
            </span>
            {canEdit && (
              <button type="button" onClick={() => remove(i.id)} aria-label={`حذف البند ${i.body}`}
                className="text-gray-300 opacity-0 transition group-hover:opacity-100 hover:text-red-600 focus:opacity-100">
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-2 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="أضف بنداً ثم Enter" maxLength={500}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
          <button type="button" onClick={add} disabled={busy || !text.trim()} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-40">إضافة</button>
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
    </section>
  );
}
