"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyTaskError } from "@/lib/tasks";
import type { AssignablePerson, TaskDetail, TaskRow } from "@/lib/types";
import { StatusBadge } from "../badges";
import { useTaskActions } from "../use-task-actions";

// ============================================================
// العلاقات: المهام الفرعية (٣ / ٥)، التبعيات (تعتمد على / تُعطِّل)،
// والمتابِعون. التبعية الدائرية ترفضها القاعدة برسالة واضحة.
// ============================================================
export default function RelationsPanel({ detail, people }: { detail: TaskDetail; people: AssignablePerson[] }) {
  const t = detail.task;
  const canEdit = detail.permissions.can_edit;
  const router = useRouter();
  const supabase = createClient();
  const a = useTaskActions();
  const [sub, setSub] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TaskRow[]>([]);
  const [watcher, setWatcher] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const subDone = detail.subtasks.filter((s) => s.status === "منجزة").length;

  async function addSub() {
    const title = sub.trim();
    if (!title) return;
    const r = await a.save({ title, parent_task_id: t.id, created_source: "subtask", assigned_to: t.assigned_to });
    if (r) setSub("");
  }

  // البحث عن مهمة للتبعية — في الخادم، بعد توقّف الكتابة
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const h = setTimeout(async () => {
      const { data } = await supabase.rpc("task_list", { p: { q: q.trim(), archived: "include" }, p_limit: 8, p_offset: 0 });
      const rows = ((data as { rows: TaskRow[] } | null)?.rows ?? []).filter(
        (r) => r.id !== t.id && !detail.depends_on.some((d) => d.id === r.id));
      setHits(rows);
    }, 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function addDep(id: string) {
    setErr(null);
    const { error } = await supabase.from("task_dependencies").insert({ task_id: t.id, depends_on_id: id, is_blocking: true });
    if (error) {
      console.error(error);
      return setErr(friendlyTaskError(error));
    }
    setQ("");
    setHits([]);
    router.refresh();
  }

  async function removeDep(id: string) {
    const { error } = await supabase.from("task_dependencies").delete().eq("task_id", t.id).eq("depends_on_id", id);
    if (error) return setErr(friendlyTaskError(error));
    router.refresh();
  }

  async function addWatcher() {
    if (!watcher) return;
    const { error } = await supabase.from("task_watchers").insert({ task_id: t.id, user_id: watcher });
    if (error) {
      console.error(error);
      return setErr(error.code === "23505" ? "يتابعها بالفعل." : friendlyTaskError(error));
    }
    setWatcher("");
    router.refresh();
  }

  async function removeWatcher(uid: string) {
    const { error } = await supabase.from("task_watchers").delete().eq("task_id", t.id).eq("user_id", uid);
    if (error) return setErr(friendlyTaskError(error));
    router.refresh();
  }

  const row = (x: { id: string; title: string; status: string; assigned_to_name?: string | null }, after?: React.ReactNode) => (
    <li key={x.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-subtle">
      <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${x.status === "منجزة" ? "text-emerald-500" : "text-gray-300"}`}>
        {x.status === "منجزة" ? "check_circle" : "radio_button_unchecked"}
      </span>
      <Link href={`/dashboard/tasks/${x.id}`} className={`min-w-0 flex-1 truncate text-sm hover:text-brand-700 ${x.status === "منجزة" ? "text-gray-400 line-through" : "text-ink"}`}>
        {x.title}
      </Link>
      {x.assigned_to_name && <span className="hidden text-[11px] text-gray-400 sm:inline">{x.assigned_to_name}</span>}
      <StatusBadge status={x.status} />
      {after}
    </li>
  );

  return (
    <div className="space-y-4">
      {/* الفرعية */}
      <section className="dash-card p-4" aria-label="المهام الفرعية">
        <h2 className="mb-2 flex items-center justify-between font-bold text-ink">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined">account_tree</span>المهام الفرعية
          </span>
          {detail.subtasks.length > 0 && <span className="text-xs font-normal text-gray-500" dir="ltr">{subDone}/{detail.subtasks.length}</span>}
        </h2>
        <ul className="space-y-0.5">{detail.subtasks.map((s) => row(s))}</ul>
        {detail.subtasks.length === 0 && <p className="text-sm text-gray-400">لا مهام فرعية.</p>}
        {canEdit && (
          <div className="mt-2 flex gap-2">
            <input value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSub()}
              placeholder="مهمة فرعية سريعة ثم Enter" maxLength={300}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            <Link href={`/dashboard/tasks/new?parent=${t.id}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600">بالتفصيل</Link>
          </div>
        )}
      </section>

      {/* التبعيات */}
      <section className="dash-card p-4" aria-label="التبعيات">
        <h2 className="mb-2 flex items-center gap-2 font-bold text-ink">
          <span aria-hidden="true" className="material-symbols-outlined">link</span>التبعيات
        </h2>
        <p className="text-xs font-semibold text-gray-500">تعتمد على</p>
        <ul className="mb-2 space-y-0.5">
          {detail.depends_on.map((d) => row(d, canEdit && (
            <button type="button" onClick={() => removeDep(d.id)} aria-label="إزالة التبعية" className="text-gray-300 hover:text-red-600">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">link_off</span>
            </button>
          )))}
          {detail.depends_on.length === 0 && <li className="text-sm text-gray-400">لا شيء — تبدأ متى شئت.</li>}
        </ul>
        {detail.dependents.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-500">تنتظرها</p>
            <ul className="mb-2 space-y-0.5">{detail.dependents.map((d) => row(d))}</ul>
          </>
        )}
        {canEdit && (
          <div className="relative">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن مهمة تعتمد عليها…"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            {hits.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-white shadow-card">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" onClick={() => addDep(h.id)} className="block w-full px-3 py-2 text-start text-sm hover:bg-brand-50">
                      {h.title} <span className="text-[11px] text-gray-400">— {h.assigned_to_name} · {h.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* المتابعون */}
      <section className="dash-card p-4" aria-label="المتابعون">
        <h2 className="mb-2 flex items-center gap-2 font-bold text-ink">
          <span aria-hidden="true" className="material-symbols-outlined">visibility</span>المتابعون
        </h2>
        <ul className="flex flex-wrap gap-1.5">
          {detail.watchers.map((w) => (
            <li key={w.user_id} className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2.5 py-1 text-xs">
              {w.name}
              {canEdit && (
                <button type="button" onClick={() => removeWatcher(w.user_id)} aria-label={`إزالة ${w.name}`} className="text-gray-400 hover:text-red-600">×</button>
              )}
            </li>
          ))}
          {detail.watchers.length === 0 && <li className="text-sm text-gray-400">لا متابعين.</li>}
        </ul>
        {canEdit && people.length > 1 && (
          <div className="mt-2 flex gap-2">
            <select value={watcher} onChange={(e) => setWatcher(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm" aria-label="أضف متابعاً">
              <option value="">أضف متابعاً…</option>
              {people.filter((p) => p.user_id !== t.assigned_to && !detail.watchers.some((w) => w.user_id === p.user_id))
                .map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
            </select>
            <button type="button" onClick={addWatcher} disabled={!watcher} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-40">إضافة</button>
          </div>
        )}
      </section>

      {(err || a.error) && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err ?? a.error}</p>}
    </div>
  );
}
