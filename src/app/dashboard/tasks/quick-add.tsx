"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ChatPerson, TASK_PRIORITIES } from "@/lib/types";
import { baghdadDate } from "@/lib/time";

// ============================================================
// إضافة مهمة بسطر واحد — للمهام السريعة التي لا تحتاج تفاصيل.
// (للتفاصيل الكاملة يوجد زر «مهمة بالتفصيل»)
// ============================================================
export default function QuickAdd({
  people,
  myUserId,
  isAdmin,
}: {
  people: ChatPerson[];
  myUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState(myUserId);
  const [priority, setPriority] = useState<string>("عادية");
  const [dueDate, setDueDate] = useState(baghdadDate());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);

    const { error } = await supabase.from("tasks").insert({
      title: title.trim(),
      assigned_to: isAdmin ? assignee : myUserId,
      created_by: myUserId,
      priority,
      due_date: dueDate,
    });

    setSaving(false);
    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }
    setTitle("");
    router.refresh();
  }

  return (
    <div className="glass-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="اكتب مهمة جديدة ثم اضغط Enter..."
          className="min-w-[220px] flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
        />

        {isAdmin && (
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            title="المسؤول عن التنفيذ"
          >
            {people.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.name}
                {p.user_id === myUserId ? " (أنا)" : ""}
              </option>
            ))}
          </select>
        )}

        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
          title="الأولوية"
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
          title="يوم التنفيذ"
        />

        <button
          onClick={add}
          disabled={saving || !title.trim()}
          className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          {saving ? "..." : "إضافة"}
        </button>
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
    </div>
  );
}
