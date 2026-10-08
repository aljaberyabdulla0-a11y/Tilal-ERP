"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyTaskError, LABEL_COLOR_CLASSES } from "@/lib/tasks";
import {
  TASK_PRIORITIES,
  type AssignablePerson, type TaskAssignRule, type TaskAutomationRule, type TaskDepartment, type TaskLabel,
  type TaskRecurrence, type TaskTypeDef, type TaskWorkflow, type TaskWorkspace,
} from "@/lib/types";
import AssignRuleEditor from "./assign-rule-editor";

const field = "rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm";

function useSave() {
  const router = useRouter();
  const supabase = createClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(p: PromiseLike<{ error: { message: string; code?: string } | null }>) {
    setBusy(true);
    setErr(null);
    const { error } = await p;
    setBusy(false);
    if (error) {
      console.error(error);
      setErr(friendlyTaskError(error));
      return false;
    }
    router.refresh();
    return true;
  }
  return { supabase, err, busy, run };
}

// ============================================================
// إعداد الأقسام: المساحة (تختار تخطيط الواجهة)، «قريبة الموعد»، إلزام
// سبب الإلغاء، المسار الافتراضي. الفرع بلا صفّ يرث من أبيه.
// ============================================================
export function DepartmentSettingsPanel({
  departments, workspaces, workflows, ownRows,
}: {
  departments: TaskDepartment[];
  workspaces: TaskWorkspace[];
  workflows: TaskWorkflow[];
  ownRows: string[];   // الأقسام التي لها صفّ خاص (لا موروث)
}) {
  const s = useSave();
  async function save(d: TaskDepartment, patch: Partial<TaskDepartment>) {
    const next = { ...d, ...patch };
    await s.run(s.supabase.from("department_task_settings").upsert({
      department_id: d.id,
      workspace: next.workspace ?? "general",
      due_soon_hours: next.due_soon_hours ?? 24,
      requires_cancel_reason: next.requires_cancel_reason,
      default_workflow_id: next.default_workflow_id,
      updated_at: new Date().toISOString(),
    }));
  }
  return (
    <section className="dash-card overflow-hidden">
      <h2 className="border-b border-line px-4 py-3 font-bold text-ink">الأقسام ومساحاتها</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-surface-subtle text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 text-start">القسم</th><th className="px-2 py-2">المساحة</th>
              <th className="px-2 py-2">«قريبة» قبل (ساعة)</th><th className="px-2 py-2">سبب الإلغاء</th><th className="px-2 py-2">المسار الافتراضي</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id} className="border-t border-line">
                <td className="px-3 py-2">
                  {d.parent_id ? "— " : ""}{d.name_ar}
                  {!ownRows.includes(d.id) && d.workspace && <span className="ms-1 text-[11px] text-gray-400">(موروث)</span>}
                </td>
                <td className="px-2 py-2 text-center">
                  <select defaultValue={d.workspace ?? ""} onChange={(e) => save(d, { workspace: e.target.value || "general" })} className={field} aria-label={`مساحة ${d.name_ar}`}>
                    <option value="">—</option>
                    {workspaces.map((w) => <option key={w.code} value={w.code}>{w.name_ar}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2 text-center">
                  <input type="number" min={1} max={720} defaultValue={d.due_soon_hours ?? 24} aria-label="ساعات"
                    onBlur={(e) => Number(e.target.value) !== (d.due_soon_hours ?? 24) && save(d, { due_soon_hours: Number(e.target.value) })}
                    className={`${field} w-20`} />
                </td>
                <td className="px-2 py-2 text-center">
                  <input type="checkbox" defaultChecked={d.requires_cancel_reason} aria-label="إلزام سبب الإلغاء"
                    onChange={(e) => save(d, { requires_cancel_reason: e.target.checked })} />
                </td>
                <td className="px-2 py-2 text-center">
                  <select defaultValue={d.default_workflow_id ?? ""} onChange={(e) => save(d, { default_workflow_id: e.target.value || null })} className={field} aria-label="المسار">
                    <option value="">—</option>
                    {workflows.map((w) => <option key={w.id} value={w.id}>{w.name_ar}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.err && <p role="alert" className="px-4 pb-3 text-sm text-red-700">{s.err}</p>}
    </section>
  );
}

// ============================================================
// أنواع المهام — قابلة للإضافة. «نظام» لا يُختار يدوياً.
// ============================================================
export function TaskTypesPanel({ types, workspaces }: { types: TaskTypeDef[]; workspaces: TaskWorkspace[] }) {
  const s = useSave();
  const [n, setN] = useState({ code: "", name_ar: "", workspace: "", icon: "task_alt" });
  const upd = (code: string, patch: Partial<TaskTypeDef>) => s.run(s.supabase.from("task_types").update(patch).eq("code", code));
  async function add() {
    if (!/^[a-z][a-z0-9_]*$/.test(n.code) || !n.name_ar.trim()) return;
    const ok = await s.run(s.supabase.from("task_types").insert({ code: n.code, name_ar: n.name_ar.trim(), workspace: n.workspace || null, icon: n.icon || "task_alt" }));
    if (ok) setN({ code: "", name_ar: "", workspace: "", icon: "task_alt" });
  }
  return (
    <section className="dash-card overflow-hidden">
      <h2 className="border-b border-line px-4 py-3 font-bold text-ink">أنواع المهام</h2>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="sticky top-0 bg-surface-subtle text-xs text-gray-500">
            <tr><th className="px-3 py-2 text-start">النوع</th><th className="px-2">المساحة</th><th className="px-2">SLA (ساعة)</th><th className="px-2">سبب إلغاء</th><th className="px-2">موافقة</th><th className="px-2">مفعّل</th></tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.code} className="border-t border-line">
                <td className="px-3 py-1.5">
                  <span aria-hidden="true" className="material-symbols-outlined me-1 align-[-5px] text-[18px] text-brand-600">{t.icon}</span>
                  {t.name_ar} <span className="text-[11px] text-gray-400" dir="ltr">{t.code}</span>
                  {t.is_system && <span className="ms-1 rounded bg-gray-100 px-1 text-[10px] text-gray-500">نظام</span>}
                </td>
                <td className="px-2 text-center text-xs">{workspaces.find((w) => w.code === t.workspace)?.name_ar ?? "الكل"}</td>
                <td className="px-2 text-center">
                  <input type="number" min={1} defaultValue={t.sla_hours ?? ""} aria-label="SLA"
                    onBlur={(e) => upd(t.code, { sla_hours: e.target.value ? Number(e.target.value) : null })} className={`${field} w-20`} />
                </td>
                <td className="px-2 text-center"><input type="checkbox" defaultChecked={t.requires_cancel_reason} onChange={(e) => upd(t.code, { requires_cancel_reason: e.target.checked })} aria-label="سبب الإلغاء" /></td>
                <td className="px-2 text-center"><input type="checkbox" defaultChecked={t.requires_approval} onChange={(e) => upd(t.code, { requires_approval: e.target.checked })} aria-label="موافقة" /></td>
                <td className="px-2 text-center"><input type="checkbox" defaultChecked={t.is_active} disabled={t.code === "general"} onChange={(e) => upd(t.code, { is_active: e.target.checked })} aria-label="مفعّل" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
        <input value={n.name_ar} onChange={(e) => setN({ ...n, name_ar: e.target.value })} placeholder="اسم النوع" className={field} />
        <input value={n.code} onChange={(e) => setN({ ...n, code: e.target.value.toLowerCase() })} placeholder="code_latin" dir="ltr" className={`${field} w-32`} />
        <select value={n.workspace} onChange={(e) => setN({ ...n, workspace: e.target.value })} className={field} aria-label="المساحة">
          <option value="">كل المساحات</option>
          {workspaces.map((w) => <option key={w.code} value={w.code}>{w.name_ar}</option>)}
        </select>
        <input value={n.icon} onChange={(e) => setN({ ...n, icon: e.target.value })} placeholder="أيقونة" dir="ltr" className={`${field} w-28`} />
        <button type="button" onClick={add} disabled={s.busy} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white">إضافة نوع</button>
      </div>
      {s.err && <p role="alert" className="px-4 pb-3 text-sm text-red-700">{s.err}</p>}
    </section>
  );
}

// ============================================================
// الوسوم
// ============================================================
export function LabelsPanel({ labels, departments }: { labels: TaskLabel[]; departments: TaskDepartment[] }) {
  const s = useSave();
  const [name, setName] = useState("");
  const [color, setColor] = useState("gray");
  const [dept, setDept] = useState("");
  async function add() {
    if (!name.trim()) return;
    const ok = await s.run(s.supabase.from("task_labels").insert({ name: name.trim(), color, department_id: dept || null }));
    if (ok) setName("");
  }
  return (
    <section className="dash-card p-4">
      <h2 className="mb-3 font-bold text-ink">الوسوم</h2>
      <ul className="mb-3 flex flex-wrap gap-1.5">
        {labels.map((l) => (
          <li key={l.id} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${LABEL_COLOR_CLASSES[l.color]}`}>
            #{l.name}{l.department_id && <span className="font-normal opacity-70">({departments.find((d) => d.id === l.department_id)?.name_ar})</span>}
            <button type="button" onClick={() => s.run(s.supabase.from("task_labels").update({ is_active: false }).eq("id", l.id))} aria-label={`تعطيل ${l.name}`}>×</button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الوسم" maxLength={40} className={field} />
        <select value={color} onChange={(e) => setColor(e.target.value)} className={field} aria-label="اللون">
          {Object.keys(LABEL_COLOR_CLASSES).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={dept} onChange={(e) => setDept(e.target.value)} className={field} aria-label="القسم">
          <option value="">عام</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
        </select>
        <button type="button" onClick={add} disabled={s.busy} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white">إضافة</button>
      </div>
      {s.err && <p role="alert" className="mt-2 text-sm text-red-700">{s.err}</p>}
    </section>
  );
}

const FREQ: Record<string, string> = { daily: "يومياً", weekly: "أسبوعياً", monthly: "شهرياً", yearly: "سنوياً", custom_days: "كل N يوم" };
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

// ============================================================
// المهام المتكررة — تُولَّد ٥:٠٠ بغداد، ومهمة واحدة لكل موعد مهما
// أُعيد التشغيل (فهرس فريد في القاعدة).
// ============================================================
export function RecurrencesPanel({
  rows, people, departments, types, templates, roles, todayISO,
}: {
  rows: TaskRecurrence[];
  people: AssignablePerson[];
  departments: TaskDepartment[];
  types: TaskTypeDef[];
  templates: { id: string; name_ar: string }[];
  roles: { code: string; name_ar: string }[];
  todayISO: string;
}) {
  const s = useSave();
  const me = people.find((p) => p.is_me)?.user_id ?? "";
  const [n, setN] = useState({
    title: "", frequency: "weekly", interval_n: 1, weekdays: [0] as number[], month_day: 1,
    start_on: todayISO, end_on: "", due_offset_days: 0, priority: "عادية", task_type: "general",
    department_id: "", template_id: "", assigned_to: me, rule: null as TaskAssignRule | null,
  });
  async function add() {
    if (!n.title.trim()) return;
    const ok = await s.run(s.supabase.from("task_recurrences").insert({
      title: n.title.trim(), frequency: n.frequency, interval_n: n.interval_n,
      weekdays: n.frequency === "weekly" ? n.weekdays : null,
      month_day: n.frequency === "monthly" || n.frequency === "yearly" ? n.month_day : null,
      start_on: n.start_on, end_on: n.end_on || null, due_offset_days: n.due_offset_days,
      priority: n.priority, task_type: n.task_type, department_id: n.department_id || null,
      template_id: n.template_id || null,
      assigned_to: n.rule ? null : n.assigned_to || me, assign_rule: n.rule,
    }));
    if (ok) setN({ ...n, title: "" });
  }
  return (
    <section className="dash-card overflow-hidden">
      <h2 className="border-b border-line px-4 py-3 font-bold text-ink">المهام المتكررة</h2>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <b className="text-ink">{r.title}</b>
              <span className="ms-2 text-xs text-ink-muted">
                {FREQ[r.frequency]}{r.interval_n > 1 ? ` (كل ${r.interval_n})` : ""}
                {r.frequency === "weekly" && r.weekdays?.length ? ` · ${r.weekdays.map((d) => DAYS[d]).join("، ")}` : ""}
                {r.next_run_on ? ` · التالي ${r.next_run_on}` : " · انتهى"}
              </span>
            </span>
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" defaultChecked={r.is_active}
                onChange={(e) => s.run(s.supabase.from("task_recurrences").update({ is_active: e.target.checked }).eq("id", r.id))} />مفعّل
            </label>
            <button type="button" onClick={() => confirm("حذف التكرار؟ المهام المولَّدة تبقى.") && s.run(s.supabase.from("task_recurrences").delete().eq("id", r.id))}
              className="text-xs text-red-600 hover:underline">حذف</button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-4 text-sm text-gray-400">لا مهام متكررة — مثل «تقرير التسويق الأسبوعي» أو «الإقفال الشهري».</li>}
      </ul>
      <div className="space-y-2 border-t border-line p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input value={n.title} onChange={(e) => setN({ ...n, title: e.target.value })} placeholder="عنوان المهمة المتكررة" className={`${field} min-w-0 flex-1`} />
          <select value={n.frequency} onChange={(e) => setN({ ...n, frequency: e.target.value })} className={field} aria-label="التكرار">
            {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {(n.frequency === "custom_days" || n.interval_n > 1 || n.frequency !== "daily") && (
            <label className="flex items-center gap-1 text-xs text-gray-600">كل
              <input type="number" min={1} max={365} value={n.interval_n} onChange={(e) => setN({ ...n, interval_n: Number(e.target.value) || 1 })} className={`${field} w-16`} />
            </label>
          )}
          {n.frequency === "weekly" && (
            <span className="flex flex-wrap gap-1">
              {DAYS.map((d, i) => (
                <button key={d} type="button" aria-pressed={n.weekdays.includes(i)}
                  onClick={() => setN({ ...n, weekdays: n.weekdays.includes(i) ? n.weekdays.filter((x) => x !== i) : [...n.weekdays, i] })}
                  className={`rounded px-1.5 py-1 text-[11px] ${n.weekdays.includes(i) ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600"}`}>{d}</button>
              ))}
            </span>
          )}
          {(n.frequency === "monthly" || n.frequency === "yearly") && (
            <label className="flex items-center gap-1 text-xs text-gray-600">يوم
              <input type="number" min={1} max={31} value={n.month_day} onChange={(e) => setN({ ...n, month_day: Number(e.target.value) || 1 })} className={`${field} w-16`} />
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-600">من <input type="date" value={n.start_on} onChange={(e) => setN({ ...n, start_on: e.target.value })} className={field} /></label>
          <label className="text-xs text-gray-600">حتى <input type="date" value={n.end_on} onChange={(e) => setN({ ...n, end_on: e.target.value })} className={field} /></label>
          <select value={n.priority} onChange={(e) => setN({ ...n, priority: e.target.value })} className={field} aria-label="الأولوية">
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={n.task_type} onChange={(e) => setN({ ...n, task_type: e.target.value })} className={field} aria-label="النوع">
            {types.filter((t) => t.is_active && !t.is_system).map((t) => <option key={t.code} value={t.code}>{t.name_ar}</option>)}
          </select>
          <select value={n.department_id} onChange={(e) => setN({ ...n, department_id: e.target.value })} className={field} aria-label="القسم">
            <option value="">القسم: قسم المسؤول</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
          </select>
          <select value={n.template_id} onChange={(e) => setN({ ...n, template_id: e.target.value })} className={field} aria-label="القالب">
            <option value="">بلا قالب</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name_ar}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-600">المسؤول:</span>
          {!n.rule ? (
            <>
              <select value={n.assigned_to} onChange={(e) => setN({ ...n, assigned_to: e.target.value })} className={field} aria-label="المسؤول">
                {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}{p.is_me ? " (أنا)" : ""}</option>)}
              </select>
              <button type="button" onClick={() => setN({ ...n, rule: { kind: "least_loaded", fallback: { kind: "creator" } } })} className="text-xs text-brand-700">أو بقاعدة</button>
            </>
          ) : (
            <>
              <AssignRuleEditor value={n.rule} onChange={(v) => setN({ ...n, rule: v })} people={people} departments={departments} roles={roles} />
              <button type="button" onClick={() => setN({ ...n, rule: null })} className="text-xs text-gray-500">موظف محدّد</button>
            </>
          )}
          <button type="button" onClick={add} disabled={s.busy || !n.title.trim()} className="ms-auto rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
            إضافة التكرار
          </button>
        </div>
      </div>
      {s.err && <p role="alert" className="px-4 pb-3 text-sm text-red-700">{s.err}</p>}
    </section>
  );
}

const EVENTS: Record<string, string> = {
  "employee.created": "عند إضافة موظف",
  "employee.ended": "عند خروج موظف",
  "campaign.created": "عند إنشاء حملة",
  "content.created": "عند إنشاء محتوى",
  "invoice.overdue": "فاتورة متأخرة غير مسدّدة (فحص يومي)",
};

// ============================================================
// الأتمتة: حدث → قاعدة → قالب. القواعد المزروعة معطّلة حتى يقرّر المدير.
// ============================================================
export function AutomationPanel({
  rules, templates, runs,
}: {
  rules: TaskAutomationRule[];
  templates: { id: string; name_ar: string }[];
  runs: Record<string, { ok: number; error: number; last: string | null }>;
}) {
  const s = useSave();
  const [n, setN] = useState({ name_ar: "", event: "campaign.created", template_id: "" });
  async function add() {
    if (!n.name_ar.trim() || !n.template_id) return;
    const ok = await s.run(s.supabase.from("task_automation_rules").insert({ ...n, name_ar: n.name_ar.trim(), is_active: false }));
    if (ok) setN({ ...n, name_ar: "" });
  }
  return (
    <section className="dash-card overflow-hidden">
      <h2 className="border-b border-line px-4 py-3 font-bold text-ink">الأتمتة</h2>
      <ul className="divide-y divide-line">
        {rules.map((r) => {
          const st = runs[r.id];
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <b className="text-ink">{r.name_ar}</b>
                <span className="ms-2 text-xs text-ink-muted">
                  {EVENTS[r.event] ?? r.event} ← {templates.find((t) => t.id === r.template_id)?.name_ar ?? "قالب"}
                  {st ? ` · نُفّذت ${st.ok}${st.error ? ` · فشلت ${st.error}` : ""}` : ""}
                </span>
                {r.description && <span className="block text-[11px] text-gray-400">{r.description}</span>}
              </span>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" defaultChecked={r.is_active}
                  onChange={(e) => s.run(s.supabase.from("task_automation_rules").update({ is_active: e.target.checked, updated_at: new Date().toISOString() }).eq("id", r.id))} />
                مفعّلة
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
        <input value={n.name_ar} onChange={(e) => setN({ ...n, name_ar: e.target.value })} placeholder="اسم القاعدة" className={`${field} min-w-0 flex-1`} />
        <select value={n.event} onChange={(e) => setN({ ...n, event: e.target.value })} className={field} aria-label="الحدث">
          {Object.entries(EVENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={n.template_id} onChange={(e) => setN({ ...n, template_id: e.target.value })} className={field} aria-label="القالب">
          <option value="">القالب…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name_ar}</option>)}
        </select>
        <button type="button" onClick={add} disabled={s.busy} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white">إضافة (معطّلة)</button>
      </div>
      {s.err && <p role="alert" className="px-4 pb-3 text-sm text-red-700">{s.err}</p>}
    </section>
  );
}
