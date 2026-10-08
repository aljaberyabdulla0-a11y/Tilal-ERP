"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyTaskError } from "@/lib/tasks";
import {
  TASK_PRIORITIES,
  type AssignablePerson, type TaskAssignRule, type TaskDepartment, type TaskTemplate, type TaskTemplateItem,
  type TaskTypeDef, type TaskWorkflow, type TaskWorkspace,
} from "@/lib/types";
import AssignRuleEditor from "./assign-rule-editor";

const blankItem = (position: number): TaskTemplateItem => ({
  position, title: "", description: null, task_type: null, priority: null, offset_days: 0, estimated_minutes: null,
  assign_rule: null, checklist: [], depends_on_position: null, requires_approval: false, workflow_step_code: null,
});

// ============================================================
// محرّر القالب: المهمة الرئيسية + بنود فرعية بإزاحة أيام وتبعية بالترتيب
// وقائمة تحقق وقاعدة إسناد لكل بند. الكتابة مباشرة على الجدولين (RLS:
// مدير الإعدادات، أو مدير القسم، أو صاحب القالب).
// ============================================================
export default function TemplateEditor({
  template, people, departments, types, workflows, workspaces, roles,
}: {
  template: TaskTemplate | null;
  people: AssignablePerson[];
  departments: TaskDepartment[];
  types: TaskTypeDef[];
  workflows: TaskWorkflow[];
  workspaces: TaskWorkspace[];
  roles: { code: string; name_ar: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [t, setT] = useState({
    name_ar: template?.name_ar ?? "",
    description: template?.description ?? "",
    workspace: template?.workspace ?? "",
    department_id: template?.department_id ?? "",
    task_type: template?.task_type ?? "general",
    default_priority: template?.default_priority ?? "عادية",
    estimated_minutes: template?.estimated_minutes?.toString() ?? "",
    due_offset_days: template?.due_offset_days ?? 0,
    workflow_id: template?.workflow_id ?? "",
    checklist: (template?.checklist ?? []).join("\n"),
    assign_rule: (template?.assign_rule ?? { kind: "creator" }) as TaskAssignRule,
    requires_approval: template?.requires_approval ?? false,
    is_active: template?.is_active ?? true,
  });
  const [items, setItems] = useState<TaskTemplateItem[]>(
    (template?.items ?? []).map((i) => ({ ...i, checklist: i.checklist ?? [] })),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setItem = (idx: number, patch: Partial<TaskTemplateItem>) =>
    setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) =>
    setItems((list) => list.filter((_, i) => i !== idx).map((it, i) => ({
      ...it, position: i + 1,
      depends_on_position: it.depends_on_position === idx + 1 ? null
        : it.depends_on_position && it.depends_on_position > idx + 1 ? it.depends_on_position - 1 : it.depends_on_position,
    })));
  const workflow = workflows.find((w) => w.id === t.workflow_id);

  async function save() {
    setErr(null);
    if (!t.name_ar.trim()) return setErr("اكتب اسم القالب.");
    if (items.some((i) => !i.title.trim())) return setErr("كل بند يحتاج عنواناً.");
    setBusy(true);
    const row = {
      name_ar: t.name_ar.trim(),
      description: t.description.trim() || null,
      workspace: t.workspace || null,
      department_id: t.department_id || null,
      task_type: t.task_type,
      default_priority: t.default_priority,
      estimated_minutes: t.estimated_minutes ? Number(t.estimated_minutes) : null,
      due_offset_days: Number(t.due_offset_days) || 0,
      workflow_id: t.workflow_id || null,
      checklist: t.checklist.split("\n").map((s) => s.trim()).filter(Boolean),
      assign_rule: t.assign_rule,
      requires_approval: t.requires_approval,
      is_active: t.is_active,
      updated_at: new Date().toISOString(),
    };
    let id = template?.id;
    if (id) {
      const { error } = await supabase.from("task_templates").update(row).eq("id", id);
      if (error) { setBusy(false); console.error(error); return setErr(friendlyTaskError(error)); }
      const del = await supabase.from("task_template_items").delete().eq("template_id", id);
      if (del.error) { setBusy(false); return setErr(friendlyTaskError(del.error)); }
    } else {
      const { data, error } = await supabase.from("task_templates").insert(row).select("id").single();
      if (error || !data) { setBusy(false); console.error(error); return setErr(friendlyTaskError(error)); }
      id = (data as { id: string }).id;
    }
    if (items.length) {
      const { error } = await supabase.from("task_template_items").insert(items.map((i, idx) => ({
        template_id: id,
        position: idx + 1,
        title: i.title.trim(),
        description: i.description,
        task_type: i.task_type || null,
        priority: i.priority || null,
        offset_days: Number(i.offset_days) || 0,
        estimated_minutes: i.estimated_minutes,
        assign_rule: i.assign_rule,
        checklist: i.checklist.filter(Boolean),
        depends_on_position: i.depends_on_position && i.depends_on_position < idx + 1 ? i.depends_on_position : null,
        requires_approval: i.requires_approval,
        workflow_step_code: i.workflow_step_code || null,
      })));
      if (error) { setBusy(false); console.error(error); return setErr(friendlyTaskError(error)); }
    }
    setBusy(false);
    router.push("/dashboard/tasks/templates");
    router.refresh();
  }

  async function remove() {
    if (!template || !confirm("حذف القالب؟ المهام التي أُنشئت منه تبقى.")) return;
    const { error } = await supabase.from("task_templates").delete().eq("id", template.id);
    if (error) return setErr(friendlyTaskError(error));
    router.push("/dashboard/tasks/templates");
    router.refresh();
  }

  const field = "w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm";
  const label = "mb-1 block text-xs font-semibold text-gray-600";
  const typeOptions = types.filter((x) => x.is_active && !x.is_system);

  return (
    <div className="space-y-5">
      <section className="dash-card grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="tp-name">اسم القالب *</label>
          <input id="tp-name" value={t.name_ar} onChange={(e) => setT({ ...t, name_ar: e.target.value })} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="tp-ws">المساحة</label>
          <select id="tp-ws" value={t.workspace} onChange={(e) => setT({ ...t, workspace: e.target.value })} className={field}>
            <option value="">عامة</option>
            {workspaces.map((w) => <option key={w.code} value={w.code}>{w.name_ar}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={label} htmlFor="tp-desc">الوصف</label>
          <input id="tp-desc" value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="tp-dept">القسم</label>
          <select id="tp-dept" value={t.department_id} onChange={(e) => setT({ ...t, department_id: e.target.value })} className={field}>
            <option value="">— قسم المسؤول —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.parent_id ? "— " : ""}{d.name_ar}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="tp-type">نوع المهمة الرئيسية</label>
          <select id="tp-type" value={t.task_type} onChange={(e) => setT({ ...t, task_type: e.target.value })} className={field}>
            {typeOptions.map((x) => <option key={x.code} value={x.code}>{x.name_ar}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="tp-prio">الأولوية الافتراضية</label>
          <select id="tp-prio" value={t.default_priority} onChange={(e) => setT({ ...t, default_priority: e.target.value })} className={field}>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="tp-offset">موعد الرئيسية بعد (أيام)</label>
          <input id="tp-offset" type="number" min={0} max={365} value={t.due_offset_days}
            onChange={(e) => setT({ ...t, due_offset_days: Number(e.target.value) })} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="tp-est">المدّة المقدّرة (دقائق)</label>
          <input id="tp-est" type="number" min={0} value={t.estimated_minutes} onChange={(e) => setT({ ...t, estimated_minutes: e.target.value })} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="tp-wf">مسار العمل</label>
          <select id="tp-wf" value={t.workflow_id} onChange={(e) => setT({ ...t, workflow_id: e.target.value })} className={field}>
            <option value="">— بلا مسار —</option>
            {workflows.map((w) => <option key={w.id} value={w.id}>{w.name_ar}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <span className={label}>المسؤول عن الرئيسية</span>
          <AssignRuleEditor value={t.assign_rule} onChange={(v) => setT({ ...t, assign_rule: v ?? { kind: "creator" } })}
            people={people} departments={departments} roles={roles} />
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={t.requires_approval} onChange={(e) => setT({ ...t, requires_approval: e.target.checked })} />تحتاج موافقة</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={t.is_active} onChange={(e) => setT({ ...t, is_active: e.target.checked })} />مفعّل</label>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={label} htmlFor="tp-check">قائمة تحقق الرئيسية (بند في كل سطر)</label>
          <textarea id="tp-check" value={t.checklist} onChange={(e) => setT({ ...t, checklist: e.target.value })} rows={3} className={field} />
        </div>
      </section>

      <section className="dash-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-ink">المهام الفرعية ({items.length})</h2>
          <button type="button" onClick={() => setItems([...items, blankItem(items.length + 1)])}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:border-brand-500">+ بند</button>
        </div>
        <ol className="space-y-3">
          {items.map((it, idx) => (
            <li key={idx} className="rounded-xl border border-line p-3">
              <div className="grid gap-2 sm:grid-cols-[2rem_minmax(0,1fr)_10rem_7rem]">
                <span className="pt-2 text-center text-sm font-bold text-gray-400">{idx + 1}</span>
                <input value={it.title} onChange={(e) => setItem(idx, { title: e.target.value })} placeholder="عنوان البند" className={field} aria-label={`عنوان البند ${idx + 1}`} />
                <select value={it.task_type ?? ""} onChange={(e) => setItem(idx, { task_type: e.target.value || null })} className={field} aria-label="النوع">
                  <option value="">نوع الرئيسية</option>
                  {typeOptions.map((x) => <option key={x.code} value={x.code}>{x.name_ar}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs text-gray-500">بعد
                  <input type="number" min={0} max={365} value={it.offset_days} onChange={(e) => setItem(idx, { offset_days: Number(e.target.value) })}
                    className="w-14 rounded-lg border border-gray-300 px-1.5 py-1.5 text-sm" />يوم
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 ps-0 sm:ps-8">
                <AssignRuleEditor value={it.assign_rule} onChange={(v) => setItem(idx, { assign_rule: v })} allowEmpty
                  people={people} departments={departments} roles={roles} />
                <label className="flex items-center gap-1 text-xs text-gray-600">يعتمد على
                  <select value={it.depends_on_position ?? ""} onChange={(e) => setItem(idx, { depends_on_position: e.target.value ? Number(e.target.value) : null })}
                    className="rounded-lg border border-gray-300 px-1.5 py-1 text-sm">
                    <option value="">—</option>
                    {items.slice(0, idx).map((_, j) => <option key={j} value={j + 1}>البند {j + 1}</option>)}
                  </select>
                </label>
                {workflow && (
                  <select value={it.workflow_step_code ?? ""} onChange={(e) => setItem(idx, { workflow_step_code: e.target.value || null })}
                    className="rounded-lg border border-gray-300 px-1.5 py-1 text-sm" aria-label="خطوة المسار">
                    <option value="">بلا خطوة</option>
                    {workflow.steps.map((s) => <option key={s.id} value={s.code}>{s.name_ar}</option>)}
                  </select>
                )}
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  <input type="checkbox" checked={it.requires_approval} onChange={(e) => setItem(idx, { requires_approval: e.target.checked })} />موافقة
                </label>
                <button type="button" onClick={() => removeItem(idx)} className="ms-auto text-xs text-red-600 hover:underline">حذف البند</button>
              </div>
              <input value={it.checklist.join("، ")} onChange={(e) => setItem(idx, { checklist: e.target.value.split("،").map((s) => s.trim()) })}
                placeholder="قائمة تحقق البند (افصل بفاصلة عربية ،)" className={`mt-2 ${field}`} aria-label="قائمة تحقق البند" />
            </li>
          ))}
          {items.length === 0 && <li className="text-sm text-gray-400">بلا بنود — يُنشئ القالب مهمة واحدة.</li>}
        </ol>
      </section>

      {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className="rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "جاري الحفظ…" : "حفظ القالب"}
        </button>
        {template && !template.is_system && (
          <button type="button" onClick={remove} className="rounded-xl px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">حذف</button>
        )}
      </div>
    </div>
  );
}
