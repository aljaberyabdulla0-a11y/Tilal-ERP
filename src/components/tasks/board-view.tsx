"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TaskRow } from "@/lib/types";
import { boardBySteps, boardByStatus, labelClasses, progressOf, type BoardColumn } from "@/lib/tasks";
import { DueLabel, FlagChip, LabelChips, MiniProgress, PriorityBadge } from "./badges";
import { useTaskActions } from "./use-task-actions";

type Step = { id: string; name_ar: string; position: number; color: string };

// ============================================================
// اللوحة (Kanban) — بالحالة العامة، أو بخطوات المسار (التسويق).
//
// السحب والإفلات على الحاسوب، وقائمة «انقل إلى» في كل بطاقة للهاتف
// ولوحة المفاتيح. النقل متفائل: البطاقة تنتقل فوراً، وإن رفضت القاعدة
// (تبعية، موافقة، صلاحية) تعود ويظهر السبب.
// ============================================================
export default function BoardView({
  rows,
  todayISO,
  steps,
  showAssignee = true,
}: {
  rows: TaskRow[];
  todayISO: string;
  steps?: Step[];
  showAssignee?: boolean;
}) {
  const a = useTaskActions();
  const [items, setItems] = useState(rows);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => setItems(rows), [rows]);

  const byStep = Boolean(steps?.length);
  const columns: BoardColumn<TaskRow>[] = byStep ? boardBySteps(items, steps!) : boardByStatus(items);

  async function move(id: string, colKey: string) {
    const t = items.find((x) => x.id === id);
    if (!t || colKey === "none") return;
    if (byStep ? t.workflow_step_id === colKey : t.status === colKey) return;
    const before = items;
    setItems((cur) =>
      cur.map((x) =>
        x.id === id
          ? byStep
            ? { ...x, workflow_step_id: colKey, step_name: steps!.find((s) => s.id === colKey)?.name_ar ?? x.step_name }
            : { ...x, status: colKey }
          : x,
      ),
    );
    const r = byStep ? await a.setStep(id, colKey, t.version) : await a.setStatus(id, colKey, null, t.version);
    if (!r) setItems(before);
  }

  return (
    <div>
      {a.error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{a.error}</p>}
      <div className="scrollbar-hide relative -mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-3">
          {columns.map((col) => (
            <section
              key={col.key}
              aria-label={col.title}
              onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain") || dragId;
                if (id) move(id, col.key);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-2xl border bg-surface-subtle p-2 transition ${
                over === col.key ? "border-brand-400 bg-brand-50/60" : "border-line"
              }`}
            >
              <header className="mb-2 flex items-center justify-between px-1">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink">
                  <span className={`h-2.5 w-2.5 rounded-full ${labelClasses(col.color).split(" ")[0]}`} aria-hidden="true" />
                  {col.title}
                </h3>
                <span className="rounded-full bg-white px-2 text-xs text-gray-500" dir="ltr">{col.items.length}</span>
              </header>
              <div className="flex min-h-24 flex-col gap-2">
                {col.items.map((t) => {
                  const prog = progressOf(t);
                  return (
                    <article
                      key={t.id}
                      draggable
                      onDragStart={(e) => { setDragId(t.id); e.dataTransfer.setData("text/plain", t.id); }}
                      onDragEnd={() => setDragId(null)}
                      className={`cursor-grab rounded-xl border border-line bg-white p-3 shadow-sm active:cursor-grabbing ${dragId === t.id ? "opacity-50" : ""}`}
                    >
                      <Link href={`/dashboard/tasks/${t.id}`} className="dash-focus block rounded text-sm font-semibold text-ink hover:text-brand-700">
                        {t.title}
                      </Link>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                        <PriorityBadge priority={t.priority} />
                        <DueLabel date={t.due_date} todayISO={todayISO} late={t.is_late} />
                        {t.approval_status === "بانتظار الموافقة" && <FlagChip tone="purple" icon="hourglass_top">موافقة</FlagChip>}
                        {t.has_blocker && <FlagChip tone="amber" icon="link">تعتمد على غيرها</FlagChip>}
                      </div>
                      {showAssignee && <p className="mt-1 text-[11px] text-gray-500">{t.assigned_to_name}</p>}
                      {(t.campaign_name || t.client_name) && (
                        <p className="mt-0.5 truncate text-[11px] text-gray-500">{t.campaign_name ?? t.client_name}</p>
                      )}
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <LabelChips labels={t.labels} />
                        <MiniProgress done={prog.done} total={prog.total} />
                      </div>
                      <label className="mt-2 block">
                        <span className="sr-only">انقل «{t.title}» إلى</span>
                        <select
                          value=""
                          onChange={(e) => e.target.value && move(t.id, e.target.value)}
                          disabled={a.busy}
                          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-600"
                        >
                          <option value="">انقل إلى…</option>
                          {columns.filter((c) => c.key !== col.key && c.key !== "none").map((c) => (
                            <option key={c.key} value={c.key}>{c.title}</option>
                          ))}
                        </select>
                      </label>
                    </article>
                  );
                })}
                {col.items.length === 0 && <p className="px-1 py-4 text-center text-xs text-gray-400">لا مهام</p>}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
