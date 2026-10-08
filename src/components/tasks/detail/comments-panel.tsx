"use client";

import { useState } from "react";
import { timeAgo } from "@/lib/tasks";
import type { AssignablePerson, TaskComment } from "@/lib/types";
import { useTaskActions } from "../use-task-actions";

// ============================================================
// محادثة المهمة. الإشارة (@) لمن في المهمة أو لمن تملك إسناده — يصير
// متابعاً ويصله إشعار. الكاتب وحده يعدّل نصّه، والحذف ناعم.
// Ctrl/⌘+Enter يرسل.
// ============================================================
export default function CommentsPanel({
  taskId, comments, people,
}: { taskId: string; comments: TaskComment[]; people: AssignablePerson[] }) {
  const a = useTaskActions();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  async function send() {
    const text = body.trim();
    if (!text) return;
    const r = await a.comment(taskId, text, mentions);
    if (r) {
      setBody("");
      setMentions([]);
    }
  }

  async function saveEdit(id: string) {
    const r = await a.call("task_comment_edit", { p_id: id, p_body: editText });
    if (r) setEditing(null);
  }

  async function del(id: string) {
    if (!confirm("حذف التعليق؟")) return;
    await a.call("task_comment_delete", { p_id: id });
  }

  return (
    <section className="dash-card p-4" aria-label="التعليقات">
      <h2 className="mb-3 flex items-center gap-2 font-bold text-ink">
        <span aria-hidden="true" className="material-symbols-outlined">forum</span>
        التعليقات {comments.length > 0 && <span className="text-xs font-normal text-gray-500">({comments.length})</span>}
      </h2>

      <ol className="mb-4 space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="flex gap-2">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
              {(c.author_name ?? "؟").slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1 rounded-xl bg-surface-subtle px-3 py-2">
              <p className="text-xs text-gray-500">
                <b className="text-ink">{c.author_name}</b> · {timeAgo(c.created_at)}{c.edited_at ? " · عُدّل" : ""}
              </p>
              {editing === c.id ? (
                <div className="mt-1 space-y-1">
                  <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={2}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm" />
                  <div className="flex gap-2 text-xs">
                    <button type="button" onClick={() => saveEdit(c.id)} disabled={a.busy} className="font-semibold text-brand-700">حفظ</button>
                    <button type="button" onClick={() => setEditing(null)} className="text-gray-500">إلغاء</button>
                  </div>
                </div>
              ) : (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink">{c.body}</p>
              )}
              {c.mine && editing !== c.id && (
                <div className="mt-1 flex gap-3 text-[11px] text-gray-400">
                  <button type="button" onClick={() => { setEditing(c.id); setEditText(c.body); }} className="hover:text-brand-700">تعديل</button>
                  <button type="button" onClick={() => del(c.id)} className="hover:text-red-600">حذف</button>
                </div>
              )}
            </div>
          </li>
        ))}
        {comments.length === 0 && <li className="text-sm text-gray-400">لا تعليقات بعد — ابدأ المحادثة.</li>}
      </ol>

      <label htmlFor={`c-${taskId}`} className="sr-only">تعليق جديد</label>
      <textarea
        id={`c-${taskId}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
        }}
        rows={3}
        maxLength={5000}
        placeholder="اكتب تعليقاً… (Ctrl+Enter للإرسال)"
        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {people.length > 1 && (
          <select value="" onChange={(e) => e.target.value && !mentions.includes(e.target.value) && setMentions([...mentions, e.target.value])}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs" aria-label="أشِر إلى زميل">
            <option value="">@ أشِر إلى…</option>
            {people.filter((p) => !p.is_me).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </select>
        )}
        {mentions.map((m) => (
          <span key={m} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">
            @{people.find((p) => p.user_id === m)?.name}
            <button type="button" onClick={() => setMentions(mentions.filter((x) => x !== m))} aria-label="إزالة">×</button>
          </span>
        ))}
        <button type="button" onClick={send} disabled={a.busy || !body.trim()}
          className="ms-auto rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
          {a.busy ? "…" : "إرسال"}
        </button>
      </div>
      {a.error && <p role="alert" className="mt-2 text-sm text-red-700">{a.error}</p>}
    </section>
  );
}
