"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  TASK_PRIORITIES, TASK_STATUSES,
  type AssignablePerson, type Task, type TaskDepartment, type TaskEntityTypeDef, type TaskLabel, type TaskTypeDef, type TaskWorkflow,
} from "@/lib/types";
import { labelClasses } from "@/lib/tasks";
import { useTaskActions } from "./use-task-actions";

// الكيانات التي يُبحث فيها بالاسم من المتصفح (RLS تحدّد النتائج)
const SEARCHABLE: Record<string, { table: string; col: string }> = {
  client: { table: "clients", col: "name" },
  opportunity: { table: "opportunities", col: "title" },
  employee: { table: "employees", col: "full_name" },
  project: { table: "projects", col: "name" },
  campaign: { table: "crm_campaigns", col: "name" },
  content: { table: "mkt_content", col: "title" },
  invoice: { table: "invoices", col: "invoice_number" },
  developer_invoice: { table: "developer_invoices", col: "invoice_number" },
  broker_company: { table: "broker_companies", col: "name" },
  supplier: { table: "suppliers", col: "name" },
};

export type TaskFormPrefill = {
  entity_type?: string;
  entity_id?: string;
  entity_label?: string;
  parent_task_id?: string;
  parent_title?: string;
  department_id?: string;
  project_id?: string;
  task_type?: string;
  assigned_to?: string;
  suggestion?: string;   // «مالك العميل: …» — اقتراح لا فرض
};

// ============================================================
// نموذج المهمة — للإنشاء والتعديل.
//
// إصلاح الخطأ ٢: التعديل لا يرسل assigned_to إلا إن غيّره المستخدم
// فعلاً، فلا يُسحب مسؤول المهمة إلى من يعدّلها. والإصدار (version) يُرسل
// فإن عدّلها غيرك بعد فتحك لها يظهر «حدّث الصفحة» بدل الكتابة فوقه.
// ============================================================
export default function TaskForm({
  task,
  labelsOfTask = [],
  people,
  departments,
  types,
  entityTypes,
  labels,
  workflows,
  projects,
  todayISO,
  prefill = {},
  cancelReasonRequired = false,
}: {
  task?: Task;
  labelsOfTask?: string[];
  people: AssignablePerson[];
  departments: TaskDepartment[];
  types: TaskTypeDef[];
  entityTypes: TaskEntityTypeDef[];
  labels: TaskLabel[];
  workflows: TaskWorkflow[];
  projects: { id: string; name: string }[];
  todayISO: string;
  prefill?: TaskFormPrefill;
  cancelReasonRequired?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const a = useTaskActions();
  const editing = Boolean(task);
  const me = people.find((p) => p.is_me)?.user_id ?? "";
  const systemType = types.find((t) => t.code === task?.task_type)?.is_system ?? false;

  const [f, setF] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    priority: task?.priority ?? "عادية",
    status: task?.status ?? "جديدة",
    cancellation_reason: task?.cancellation_reason ?? "",
    assigned_to: task?.assigned_to ?? prefill.assigned_to ?? me,
    department_id: task?.department_id ?? prefill.department_id ?? "",
    task_type: task?.task_type ?? prefill.task_type ?? "general",
    due_date: task ? (task.due_date ?? "") : todayISO,
    due_time: task?.due_time ? task.due_time.slice(0, 5) : "",
    start_date: task?.start_date ?? "",
    next_step: task?.next_step ?? "",
    follow_up_date: task?.follow_up_date ?? "",
    entity_type: task?.entity_type ?? prefill.entity_type ?? "",
    entity_id: task?.entity_id ?? prefill.entity_id ?? "",
    project_id: task?.project_id ?? prefill.project_id ?? "",
    estimated_minutes: task?.estimated_minutes?.toString() ?? "",
    actual_minutes: task?.actual_minutes?.toString() ?? "",
    deadline_at: task?.deadline_at ? task.deadline_at.slice(0, 16) : "",
    requires_approval: task?.requires_approval ?? false,
    approver_id: task?.approver_id ?? "",
    workflow_id: task?.workflow_id ?? "",
    labels: labelsOfTask,
    checklist: "",
  });
  const [entityLabel, setEntityLabel] = useState(prefill.entity_label ?? "");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<{ id: string; label: string }[]>([]);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  // النوع: يُظهر أنواع مساحة القسم أولاً، ولا يُظهر أنواع النظام
  const deptWorkspace = departments.find((d) => d.id === f.department_id)?.workspace ?? null;
  const typeOptions = useMemo(() => {
    const usable = types.filter((t) => t.is_active && (!t.is_system || t.code === f.task_type));
    return [...usable].sort((x, y) => {
      const ax = x.workspace === deptWorkspace ? 0 : x.workspace ? 2 : 1;
      const ay = y.workspace === deptWorkspace ? 0 : y.workspace ? 2 : 1;
      return ax - ay || x.sort_order - y.sort_order;
    });
  }, [types, deptWorkspace, f.task_type]);

  // عند اختيار نوع: أولويته الافتراضية (للمهمة الجديدة فقط)
  function pickType(code: string) {
    set("task_type", code);
    const tt = types.find((t) => t.code === code);
    if (!editing && tt) {
      setF((s) => ({ ...s, task_type: code, priority: tt.default_priority, requires_approval: s.requires_approval || tt.requires_approval }));
    }
  }

  // البحث عن الكيان
  useEffect(() => {
    const def = SEARCHABLE[f.entity_type];
    if (!def || search.trim().length < 2) {
      setHits([]);
      return;
    }
    const h = setTimeout(async () => {
      const { data } = await supabase.from(def.table).select(`id, ${def.col}`).ilike(def.col, `%${search.trim()}%`).limit(8);
      setHits(((data ?? []) as unknown as Record<string, string>[]).map((r) => ({ id: r.id, label: r[def.col] ?? r.id })));
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, f.entity_type]);

  async function save() {
    setLocalErr(null);
    if (!f.title.trim()) return setLocalErr("اكتب عنوان المهمة.");
    if (f.follow_up_date && f.due_date && f.follow_up_date < f.due_date) return setLocalErr("موعد المتابعة يكون في يوم التنفيذ أو بعده.");
    if (f.entity_type && !f.entity_id) return setLocalErr("اختر الكيان المرتبط أو امسح نوعه.");
    if (editing && f.status === "ملغاة" && task?.status !== "ملغاة" && cancelReasonRequired && !f.cancellation_reason.trim())
      return setLocalErr("اكتب سبب الإلغاء.");

    const payload: Record<string, unknown> = {
      title: f.title.trim(),
      description: f.description,
      priority: f.priority,
      department_id: f.department_id,
      due_date: f.due_date,
      due_time: f.due_time,
      start_date: f.start_date,
      next_step: f.next_step,
      follow_up_date: f.follow_up_date,
      entity_type: f.entity_type,
      entity_id: f.entity_type ? f.entity_id : "",
      project_id: f.project_id,
      estimated_minutes: f.estimated_minutes,
      deadline_at: f.deadline_at ? new Date(f.deadline_at).toISOString() : "",
      requires_approval: f.requires_approval,
      approver_id: f.requires_approval ? f.approver_id : "",
      labels: f.labels,
    };
    if (!systemType) payload.task_type = f.task_type;
    if (f.workflow_id !== (task?.workflow_id ?? "")) payload.workflow_id = f.workflow_id;

    if (editing && task) {
      payload.id = task.id;
      payload.version = task.version;
      payload.actual_minutes = f.actual_minutes;
      if (f.status !== task.status) {
        payload.status = f.status;
        payload.cancellation_reason = f.cancellation_reason;
      }
      // لا يُرسل المسؤول إلا إن تغيّر فعلاً
      if (f.assigned_to && f.assigned_to !== task.assigned_to) payload.assigned_to = f.assigned_to;
      // الكيان لم يتغيّر: لا نرسله (لا فحص إعادة ربط بلا داعٍ)
      if ((task.entity_type ?? "") === f.entity_type && (task.entity_id ?? "") === f.entity_id) {
        delete payload.entity_type;
        delete payload.entity_id;
      }
    } else {
      payload.assigned_to = f.assigned_to || me;
      payload.created_source = "form";
      if (prefill.parent_task_id) payload.parent_task_id = prefill.parent_task_id;
      payload.checklist = f.checklist.split("\n").map((s) => s.trim()).filter(Boolean);
    }

    const r = await a.save(payload);
    if (r?.id) {
      router.push(`/dashboard/tasks/${r.id}`);
      router.refresh();
    }
  }

  const label = "mb-1 block text-sm font-medium text-gray-700";
  const field = "w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none";
  const wfOptions = workflows.filter((w) => !w.workspace || !deptWorkspace || w.workspace === deptWorkspace);

  return (
    <div className="dash-card space-y-5 p-4 sm:p-6">
      {prefill.parent_title && (
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800">مهمة فرعية من: <b>{prefill.parent_title}</b></p>
      )}

      <div>
        <label className={label} htmlFor="tf-title">عنوان المهمة *</label>
        <input id="tf-title" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={300}
          placeholder="مثال: الاتصال بعملاء زيارة أمس" className={field} />
      </div>

      <div>
        <label className={label} htmlFor="tf-desc">التفاصيل</label>
        <textarea id="tf-desc" value={f.description} onChange={(e) => set("description", e.target.value)} rows={3}
          placeholder="اشرح المطلوب بالضبط…" className={field} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={label} htmlFor="tf-assignee">المسؤول عن التنفيذ</label>
          {people.length > 1 ? (
            <select id="tf-assignee" value={f.assigned_to} onChange={(e) => set("assigned_to", e.target.value)} className={field}>
              {!people.some((p) => p.user_id === f.assigned_to) && task && (
                <option value={f.assigned_to}>{task.assigned_to_name ?? "المسؤول الحالي"}</option>
              )}
              {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}{p.is_me ? " (أنا)" : ""}</option>)}
            </select>
          ) : (
            <input value={task?.assigned_to_name ?? "أنا"} disabled className={`${field} bg-gray-50 text-gray-500`} />
          )}
          {prefill.suggestion && <p className="mt-1 text-xs text-brand-700">{prefill.suggestion}</p>}
        </div>

        <div>
          <label className={label} htmlFor="tf-dept">القسم</label>
          <select id="tf-dept" value={f.department_id} onChange={(e) => set("department_id", e.target.value)} className={field}>
            <option value="">قسم المسؤول تلقائياً</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.parent_id ? "— " : ""}{d.name_ar}</option>)}
          </select>
        </div>

        <div>
          <label className={label} htmlFor="tf-type">النوع</label>
          <select id="tf-type" value={f.task_type} onChange={(e) => pickType(e.target.value)} disabled={systemType} className={field}>
            {typeOptions.map((t) => <option key={t.code} value={t.code}>{t.name_ar}</option>)}
          </select>
        </div>

        <div>
          <label className={label} htmlFor="tf-prio">الأولوية</label>
          <select id="tf-prio" value={f.priority} onChange={(e) => set("priority", e.target.value)} className={field}>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div>
          <label className={label} htmlFor="tf-due">يوم التنفيذ</label>
          <input id="tf-due" type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} className={field} />
          <label className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={!f.due_date} onChange={(e) => set("due_date", e.target.checked ? "" : todayISO)} />
            بدون موعد
          </label>
        </div>

        <div>
          <label className={label} htmlFor="tf-time">الوقت</label>
          <input id="tf-time" type="time" value={f.due_time} onChange={(e) => set("due_time", e.target.value)} className={field} />
        </div>
      </div>

      {/* الخطوة القادمة والمتابعة */}
      <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4">
        <p className="mb-3 text-sm font-semibold text-brand-800">الخطوة القادمة والمتابعة</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="tf-next">ما الخطوة القادمة؟</label>
            <input id="tf-next" value={f.next_step} onChange={(e) => set("next_step", e.target.value)}
              placeholder="مثال: إرسال عرض السعر على الواتساب" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="tf-follow">موعد المتابعة</label>
            <input id="tf-follow" type="date" value={f.follow_up_date} onChange={(e) => set("follow_up_date", e.target.value)} className={field} />
          </div>
        </div>
      </div>

      {/* الربط */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="tf-etype">مرتبطة بـ</label>
          <div className="flex gap-2">
            <select id="tf-etype" value={f.entity_type}
              onChange={(e) => { set("entity_type", e.target.value); set("entity_id", ""); setEntityLabel(""); setSearch(""); }}
              className={`max-w-[45%] ${field}`}>
              <option value="">— لا شيء —</option>
              {entityTypes.filter((e) => SEARCHABLE[e.code] || e.code === f.entity_type).map((e) => (
                <option key={e.code} value={e.code}>{e.name_ar}</option>
              ))}
            </select>
            {f.entity_type && (
              f.entity_id ? (
                <span className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 text-sm">
                  <span className="truncate">{entityLabel || "مرتبطة"}</span>
                  <button type="button" onClick={() => { set("entity_id", ""); setEntityLabel(""); }} className="text-gray-400 hover:text-red-600" aria-label="إزالة الربط">×</button>
                </span>
              ) : (
                <div className="relative min-w-0 flex-1">
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم…" className={field} />
                  {hits.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-line bg-white shadow-card">
                      {hits.map((h) => (
                        <li key={h.id}>
                          <button type="button" onClick={() => { set("entity_id", h.id); setEntityLabel(h.label); setHits([]); }}
                            className="block w-full px-3 py-2 text-start text-sm hover:bg-brand-50">{h.label}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            )}
          </div>
        </div>

        <div>
          <label className={label} htmlFor="tf-project">المشروع</label>
          <select id="tf-project" value={f.project_id} onChange={(e) => set("project_id", e.target.value)} className={field}>
            <option value="">— بدون —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {/* الوقت والموافقة والمسار */}
      <details className="rounded-xl border border-line p-4" open={editing && Boolean(task?.requires_approval || task?.workflow_id || task?.estimated_minutes)}>
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">الوقت، الموافقة، المسار، الوسوم</summary>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={label} htmlFor="tf-start">تاريخ البدء</label>
            <input id="tf-start" type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="tf-est">الوقت المقدّر (دقائق)</label>
            <input id="tf-est" type="number" min={0} max={100000} value={f.estimated_minutes} onChange={(e) => set("estimated_minutes", e.target.value)} className={field} />
          </div>
          {editing && (
            <div>
              <label className={label} htmlFor="tf-act">الوقت الفعلي (دقائق)</label>
              <input id="tf-act" type="number" min={0} max={100000} value={f.actual_minutes} onChange={(e) => set("actual_minutes", e.target.value)} className={field} />
            </div>
          )}
          <div>
            <label className={label} htmlFor="tf-deadline">الموعد النهائي (SLA)</label>
            <input id="tf-deadline" type="datetime-local" value={f.deadline_at} onChange={(e) => set("deadline_at", e.target.value)} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="tf-wf">مسار العمل</label>
            <select id="tf-wf" value={f.workflow_id} onChange={(e) => set("workflow_id", e.target.value)} className={field}>
              <option value="">— بلا مسار —</option>
              {wfOptions.map((w) => <option key={w.id} value={w.id}>{w.name_ar}</option>)}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" checked={f.requires_approval} onChange={(e) => set("requires_approval", e.target.checked)} />
              تحتاج موافقة قبل الإنجاز
            </label>
            {f.requires_approval && (
              <select value={f.approver_id} onChange={(e) => set("approver_id", e.target.value)} className={`mt-2 ${field}`} aria-label="المعتمِد">
                <option value="">المعتمِد: من طلبها أو مدير القسم</option>
                {people.filter((p) => p.user_id !== f.assigned_to).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {labels.length > 0 && (
          <fieldset className="mt-4">
            <legend className={label}>الوسوم</legend>
            <div className="flex flex-wrap gap-1.5">
              {labels.filter((l) => !l.department_id || l.department_id === f.department_id).map((l) => {
                const on = f.labels.includes(l.id);
                return (
                  <button key={l.id} type="button" aria-pressed={on}
                    onClick={() => set("labels", on ? f.labels.filter((x) => x !== l.id) : [...f.labels, l.id])}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${on ? labelClasses(l.color) + " ring-2 ring-offset-1 ring-brand-400" : "bg-gray-100 text-gray-500"}`}>
                    #{l.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
      </details>

      {!editing && (
        <div>
          <label className={label} htmlFor="tf-check">قائمة التحقق (بند في كل سطر)</label>
          <textarea id="tf-check" value={f.checklist} onChange={(e) => set("checklist", e.target.value)} rows={3}
            placeholder={"تجهيز الملف\nالاتصال بالعميل\nرفع المستندات"} className={field} />
        </div>
      )}

      {editing && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="tf-status">الحالة</label>
            <select id="tf-status" value={f.status} onChange={(e) => set("status", e.target.value)} className={field}
              disabled={Boolean(task?.analysis_lost_sale_id)}>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {f.status === "ملغاة" && task?.status !== "ملغاة" && (
            <div>
              <label className={label} htmlFor="tf-reason">سبب الإلغاء{cancelReasonRequired ? " *" : ""}</label>
              <input id="tf-reason" value={f.cancellation_reason} onChange={(e) => set("cancellation_reason", e.target.value)} className={field} />
            </div>
          )}
        </div>
      )}

      {(localErr || a.error) && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{localErr ?? a.error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={a.busy}
          className="rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {a.busy ? "جاري الحفظ…" : editing ? "حفظ التعديلات" : "إضافة المهمة"}
        </button>
        <button type="button" onClick={() => router.back()} disabled={a.busy}
          className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-100">
          إلغاء
        </button>
      </div>
    </div>
  );
}
