"use client";

import { useState } from "react";
import { TASK_PRIORITIES, type AssignablePerson, type TaskDepartment, type TaskLabel, type TaskRow } from "@/lib/types";
import TaskRowCard from "./task-row-card";
import { useTaskActions } from "./use-task-actions";

// ============================================================
// القائمة مع الإجراءات الجماعية.
// كل إجراء جماعي يمرّ بـ task_bulk_update: كل صفّ بصلاحيته، والنتيجة
// «نجح n · تعذّر m (أول سبب)» — لا فشل صامت.
// ============================================================
export default function TaskListView({
  rows,
  todayISO,
  myUserId,
  people,
  departments,
  labels,
  showAssignee = true,
  variant = "default",
  empty = "لا توجد مهام بهذه المرشّحات.",
}: {
  rows: TaskRow[];
  todayISO: string;
  myUserId: string;
  people: AssignablePerson[];
  departments: TaskDepartment[];
  labels: TaskLabel[];
  showAssignee?: boolean;
  variant?: "default" | "sales";
  empty?: string;
}) {
  const a = useTaskActions();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [action, setAction] = useState("");
  const [value, setValue] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const toggle = (id: string, on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));

  async function run() {
    if (!action || sel.size === 0) return;
    const v: Record<string, unknown> =
      action === "assign" ? { user_id: value }
      : action === "priority" ? { priority: value }
      : action === "due_date" ? { due_date: value }
      : action === "department" ? { department_id: value }
      : action === "add_label" || action === "remove_label" ? { label_id: value }
      : action === "cancel" ? { reason: value }
      : {};
    const r = await a.bulk(Array.from(sel), action, v);
    const row = r?.[0];
    if (row) {
      setResult(`نجح ${row.succeeded}${row.failed ? ` · تعذّر ${row.failed}${row.first_error ? ` — ${row.first_error}` : ""}` : ""}`);
      if (!row.failed) setSel(new Set());
    }
  }

  const needsValue = ["assign", "priority", "due_date", "department", "add_label", "remove_label", "cancel"].includes(action);
  const sel2 = "rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm";

  if (rows.length === 0) {
    return (
      <div className="dash-card flex flex-col items-center gap-2 p-10 text-center">
        <span aria-hidden="true" className="material-symbols-outlined text-[40px] text-gray-300">task_alt</span>
        <p className="text-sm text-ink-muted">{empty}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="inline-flex items-center gap-2 text-gray-600">
          <input type="checkbox" checked={allOn}
            onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
          تحديد الصفحة
        </label>
        {sel.size > 0 && (
          <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 shadow-card">
            <b className="text-brand-800">{sel.size} محددة</b>
            <select value={action} onChange={(e) => { setAction(e.target.value); setValue(""); }} className={sel2} aria-label="الإجراء">
              <option value="">اختر إجراءً…</option>
              <option value="assign">إسناد إلى</option>
              <option value="priority">تغيير الأولوية</option>
              <option value="due_date">تغيير الموعد</option>
              <option value="department">نقل إلى قسم</option>
              {labels.length > 0 && <option value="add_label">إضافة وسم</option>}
              {labels.length > 0 && <option value="remove_label">إزالة وسم</option>}
              <option value="start">بدء التنفيذ</option>
              <option value="complete">إنجاز</option>
              <option value="cancel">إلغاء</option>
              <option value="archive">أرشفة (المغلقة)</option>
            </select>
            {action === "assign" && (
              <select value={value} onChange={(e) => setValue(e.target.value)} className={sel2} aria-label="المسؤول">
                <option value="">المسؤول…</option>
                {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}{p.is_me ? " (أنا)" : ""}</option>)}
              </select>
            )}
            {action === "priority" && (
              <select value={value} onChange={(e) => setValue(e.target.value)} className={sel2} aria-label="الأولوية">
                <option value="">الأولوية…</option>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            {action === "due_date" && (
              <input type="date" value={value} onChange={(e) => setValue(e.target.value)} className={sel2} aria-label="الموعد" />
            )}
            {action === "department" && (
              <select value={value} onChange={(e) => setValue(e.target.value)} className={sel2} aria-label="القسم">
                <option value="">القسم…</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
              </select>
            )}
            {(action === "add_label" || action === "remove_label") && (
              <select value={value} onChange={(e) => setValue(e.target.value)} className={sel2} aria-label="الوسم">
                <option value="">الوسم…</option>
                {labels.map((l) => <option key={l.id} value={l.id}>#{l.name}</option>)}
              </select>
            )}
            {action === "cancel" && (
              <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="سبب الإلغاء" className={sel2} />
            )}
            <button type="button" onClick={run} disabled={a.busy || !action || (needsValue && !value && action !== "cancel" && action !== "due_date")}
              className="rounded-lg bg-brand-600 px-3 py-1.5 font-semibold text-white disabled:opacity-40">
              {a.busy ? "…" : "تنفيذ"}
            </button>
            <button type="button" onClick={() => setSel(new Set())} className="text-gray-500 hover:text-gray-800">إلغاء التحديد</button>
          </div>
        )}
        {(result || a.error) && (
          <span role="status" className={`rounded-lg px-2 py-1 text-xs ${a.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            {a.error ?? result}
          </span>
        )}
      </div>

      <div className="space-y-2.5">
        {rows.map((t) => (
          <TaskRowCard
            key={t.id}
            task={t}
            todayISO={todayISO}
            myUserId={myUserId}
            showAssignee={showAssignee}
            variant={variant}
            selectable
            selected={sel.has(t.id)}
            onSelect={toggle}
          />
        ))}
      </div>
    </div>
  );
}
