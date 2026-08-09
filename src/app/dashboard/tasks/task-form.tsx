"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ChatPerson,
  Task,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/lib/types";
import { baghdadDate } from "@/lib/time";

type ClientOption = { id: string; name: string };

// ============================================================
// نموذج المهمة — يُستخدم للإضافة وللتعديل.
//
// المدير يقدر يسند المهمة لأي موظف، والموظف يكتبها لنفسه فقط
// (هذه القاعدة مطبّقة أيضاً داخل قاعدة البيانات، فلا تُخترق من المتصفح).
// ============================================================
export default function TaskForm({
  task,
  people,
  clients,
  myUserId,
  isAdmin,
}: {
  task?: Task;
  people: ChatPerson[];
  clients: ClientOption[];
  myUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const editing = Boolean(task);

  const [form, setForm] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    priority: task?.priority ?? "عادية",
    status: task?.status ?? "جديدة",
    assigned_to: task?.assigned_to ?? myUserId,
    due_date: task?.due_date ?? baghdadDate(),
    due_time: task?.due_time ? task.due_time.slice(0, 5) : "",
    next_step: task?.next_step ?? "",
    follow_up_date: task?.follow_up_date ?? "",
    client_id: task?.client_id ?? "",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!form.title.trim()) {
      setError("اكتب عنوان المهمة.");
      return;
    }
    if (form.follow_up_date && form.follow_up_date < form.due_date) {
      setError("موعد المتابعة يجب أن يكون في يوم التنفيذ أو بعده.");
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority,
      status: form.status,
      assigned_to: isAdmin ? form.assigned_to : myUserId,
      due_date: form.due_date,
      due_time: form.due_time || null,
      next_step: form.next_step.trim() || null,
      follow_up_date: form.follow_up_date || null,
      client_id: form.client_id || null,
    };

    const { error } = editing
      ? await supabase.from("tasks").update(payload).eq("id", task!.id)
      : await supabase.from("tasks").insert({ ...payload, created_by: myUserId });

    setSaving(false);

    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }

    router.push("/dashboard/tasks");
    router.refresh();
  }

  const label = "mb-1 block text-sm font-medium text-gray-700";
  const field =
    "w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none";

  return (
    <div className="glass-card space-y-5 p-6">
      {/* العنوان */}
      <div>
        <label className={label}>عنوان المهمة *</label>
        <input
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="مثال: الاتصال بعملاء زيارة أمس"
          className={field}
        />
      </div>

      {/* التفاصيل */}
      <div>
        <label className={label}>التفاصيل (اختياري)</label>
        <textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          rows={3}
          placeholder="اشرح المطلوب بالضبط..."
          className={field}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* لمن هذه المهمة */}
        <div>
          <label className={label}>المسؤول عن التنفيذ</label>
          {isAdmin ? (
            <select
              value={form.assigned_to}
              onChange={(e) => set("assigned_to", e.target.value)}
              className={field}
            >
              {people.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name}
                  {p.user_id === myUserId ? " (أنا)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input value="أنا" disabled className={`${field} bg-gray-50 text-gray-500`} />
          )}
        </div>

        {/* الأولوية */}
        <div>
          <label className={label}>الأولوية</label>
          <select
            value={form.priority}
            onChange={(e) => set("priority", e.target.value)}
            className={field}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* يوم التنفيذ */}
        <div>
          <label className={label}>يوم التنفيذ</label>
          <input
            type="date"
            value={form.due_date}
            onChange={(e) => set("due_date", e.target.value)}
            className={field}
          />
        </div>

        {/* الوقت */}
        <div>
          <label className={label}>الوقت (اختياري)</label>
          <input
            type="time"
            value={form.due_time}
            onChange={(e) => set("due_time", e.target.value)}
            className={field}
          />
        </div>
      </div>

      {/* الخطوة القادمة وموعد المتابعة — قلب الفكرة */}
      <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4">
        <p className="mb-3 text-sm font-semibold text-brand-800">
          الخطوة القادمة والمتابعة
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>ما الخطوة القادمة؟</label>
            <input
              value={form.next_step}
              onChange={(e) => set("next_step", e.target.value)}
              placeholder="مثال: إرسال عرض السعر على الواتساب"
              className={field}
            />
          </div>
          <div>
            <label className={label}>موعد المتابعة</label>
            <input
              type="date"
              value={form.follow_up_date}
              onChange={(e) => set("follow_up_date", e.target.value)}
              className={field}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* ربط بعميل */}
        <div>
          <label className={label}>مرتبطة بعميل (اختياري)</label>
          <select
            value={form.client_id}
            onChange={(e) => set("client_id", e.target.value)}
            className={field}
          >
            <option value="">— بدون —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* الحالة — عند التعديل فقط */}
        {editing && (
          <div>
            <label className={label}>الحالة</label>
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
              className={field}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جاري الحفظ..." : editing ? "حفظ التعديلات" : "إضافة المهمة"}
        </button>
        <button
          onClick={() => router.back()}
          disabled={saving}
          className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm text-gray-600 transition hover:bg-gray-100"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
