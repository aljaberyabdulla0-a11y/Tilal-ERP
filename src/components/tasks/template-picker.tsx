"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TaskTemplate } from "@/lib/types";
import { useTaskActions } from "./use-task-actions";

// ============================================================
// «أو ابدأ من قالب» — يُنشئ المهمة الرئيسية وفرعيتها وتبعياتها وقائمة
// تحققها دفعة واحدة (task_template_apply). من لا تملك إسناده في
// القالب تُسند مهمته إليك.
// ============================================================
export default function TemplatePicker({
  templates, prefill,
}: {
  templates: Pick<TaskTemplate, "id" | "name_ar" | "description" | "workspace" | "task_type">[];
  prefill: { entity_type?: string; entity_id?: string; department_id?: string; project_id?: string };
}) {
  const router = useRouter();
  const a = useTaskActions();
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  async function apply() {
    if (!id) return;
    const parent = await a.call<string>("task_template_apply", {
      p_template: id,
      p: {
        title: title.trim() || undefined,
        due_date: due || undefined,
        entity_type: prefill.entity_type,
        entity_id: prefill.entity_id,
        department_id: prefill.department_id,
        project_id: prefill.project_id,
      },
    }, { refresh: false });
    if (parent) router.push(`/dashboard/tasks/${parent}`);
  }

  const chosen = templates.find((t) => t.id === id);
  const field = "w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <aside className="dash-card h-fit space-y-3 p-4" aria-label="من قالب">
      <h2 className="flex items-center gap-2 font-bold text-ink">
        <span aria-hidden="true" className="material-symbols-outlined">library_add</span>أو ابدأ من قالب
      </h2>
      <select value={id} onChange={(e) => setId(e.target.value)} className={field} aria-label="القالب">
        <option value="">اختر قالباً…</option>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.name_ar}</option>)}
      </select>
      {chosen?.description && <p className="text-xs leading-5 text-ink-muted">{chosen.description}</p>}
      {id && (
        <>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`العنوان (افتراضياً: ${chosen?.name_ar})`} className={field} />
          <label className="block text-xs text-gray-500">موعد المهمة الرئيسية
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={`mt-1 ${field}`} />
          </label>
          <button type="button" onClick={apply} disabled={a.busy}
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {a.busy ? "يُنشأ…" : "أنشئ من القالب"}
          </button>
        </>
      )}
      {a.error && <p role="alert" className="text-sm text-red-700">{a.error}</p>}
    </aside>
  );
}
