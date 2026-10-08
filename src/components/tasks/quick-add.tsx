"use client";

import { useRef, useState } from "react";
import { TASK_PRIORITIES, type AssignablePerson, type TaskDepartment } from "@/lib/types";
import { useTaskActions } from "./use-task-actions";

// ============================================================
// إضافة مهمة بسطر واحد. Enter أو Ctrl/⌘+Enter يحفظ.
//
// قائمة المسؤولين = من تملك إسناده فعلاً (task_assignable_people في
// القاعدة) — لا isAdmin في الواجهة. والقاعدة تفحص مرة أخرى عند الحفظ.
// ============================================================
export default function QuickAdd({
  people,
  departments,
  todayISO,
  defaults = {},
}: {
  people: AssignablePerson[];
  departments: TaskDepartment[];
  todayISO: string;
  defaults?: { department_id?: string; task_type?: string; assigned_to?: string; project_id?: string; campaign_id?: string };
}) {
  const a = useTaskActions();
  const me = people.find((p) => p.is_me)?.user_id ?? "";
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState(defaults.assigned_to ?? me);
  const [dept, setDept] = useState(defaults.department_id ?? "");
  const [priority, setPriority] = useState<string>("عادية");
  const [dueDate, setDueDate] = useState(todayISO);
  const [dueTime, setDueTime] = useState("");
  const [more, setMore] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  async function add() {
    if (!title.trim() || a.busy) return;
    const r = await a.save({
      title: title.trim(),
      assigned_to: assignee || undefined,
      department_id: dept || undefined,
      priority,
      due_date: dueDate || "",
      due_time: dueTime || undefined,
      task_type: defaults.task_type,
      project_id: defaults.project_id,
      campaign_id: defaults.campaign_id,
      created_source: "quick_add",
    });
    if (r) {
      setTitle("");
      setDone("أُضيفت ✓");
      setTimeout(() => setDone(null), 2000);
      titleRef.current?.focus();
    }
  }

  const field = "rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none";

  return (
    <div className="dash-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="qa-title" className="sr-only">عنوان المهمة</label>
        <input
          id="qa-title"
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              add();
            }
          }}
          placeholder="اكتب مهمة جديدة ثم Enter…"
          maxLength={300}
          className={`min-w-0 flex-[3_1_220px] ${field}`}
        />

        {people.length > 1 && (
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={`flex-[1_1_140px] ${field}`}
            aria-label="المسؤول عن التنفيذ">
            {people.map((p) => (
              <option key={p.user_id} value={p.user_id}>{p.name}{p.is_me ? " (أنا)" : ""}</option>
            ))}
          </select>
        )}

        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={`flex-[0_1_110px] ${field}`} aria-label="الأولوية">
          {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`flex-[0_1_150px] ${field}`}
          aria-label="يوم التنفيذ" />

        <button type="button" onClick={() => setMore((v) => !v)} className="rounded-xl px-2 py-2.5 text-xs text-gray-500 hover:text-brand-700"
          aria-expanded={more}>
          {more ? "أقل" : "المزيد"}
        </button>

        <button
          type="button"
          onClick={add}
          disabled={a.busy || !title.trim()}
          className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          {a.busy ? "…" : "إضافة"}
        </button>
      </div>

      {more && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={dept} onChange={(e) => setDept(e.target.value)} className={`flex-[1_1_180px] ${field}`} aria-label="القسم">
            <option value="">القسم: قسم المسؤول تلقائياً</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.parent_id ? "— " : ""}{d.name_ar}</option>)}
          </select>
          <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={`flex-[0_1_130px] ${field}`}
            aria-label="الوقت" />
          <button type="button" onClick={() => setDueDate("")} className="text-xs text-gray-500 hover:text-brand-700">بدون موعد</button>
        </div>
      )}

      {(a.error || done) && (
        <p role={a.error ? "alert" : "status"} className={`mt-2 rounded-lg px-3 py-2 text-sm ${a.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
          {a.error ?? done}
        </p>
      )}
    </div>
  );
}
