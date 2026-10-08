"use client";

import type { AssignablePerson, TaskAssignRule, TaskDepartment } from "@/lib/types";

export const ASSIGN_KINDS: { kind: TaskAssignRule["kind"]; label: string; hint: string }[] = [
  { kind: "creator", label: "من ينشئ المهمة", hint: "المستخدم الذي استعمل القالب أو أنشأ التكرار" },
  { kind: "user", label: "موظف محدّد", hint: "" },
  { kind: "entity_owner", label: "مالك الكيان المرتبط", hint: "مالك العميل/الفرصة، صاحب الحملة، الموظف نفسه…" },
  { kind: "manager", label: "مدير مالك الكيان", hint: "المدير المباشر (employees.manager_id)" },
  { kind: "department_manager", label: "مدير القسم", hint: "أقرب مدير صعوداً في شجرة الأقسام" },
  { kind: "role", label: "صاحب دور", hint: "أول حساب نشط بهذا الدور" },
  { kind: "mkt_role", label: "دور في فريق التسويق", hint: "الأقل عبئاً بين من يحملونه" },
  { kind: "round_robin", label: "بالتناوب في قسم", hint: "واحد بعد الآخر" },
  { kind: "least_loaded", label: "الأقل عبئاً في قسم", hint: "أقل مهام مفتوحة" },
];

export const MKT_ROLES = [
  "مدير التسويق", "أخصائي تسويق", "مدير حساب", "كاتب محتوى", "مصمّم", "مصوّر", "مونتير",
  "مشتري إعلانات", "مدير منصّات", "أخصائي SEO", "مسوّق أداء", "منسّق فعاليات", "منسّق تسويق",
];

// ============================================================
// محرّر قاعدة الإسناد (192) — القاعدة تُخزَّن JSON وتُحلّ في القاعدة
// عند الإنشاء (task_resolve_assignee). «إن لم يوجد» يسقط إلى المنشئ.
// ============================================================
export default function AssignRuleEditor({
  value, onChange, people, departments, roles, allowEmpty = false,
}: {
  value: TaskAssignRule | null;
  onChange: (v: TaskAssignRule | null) => void;
  people: AssignablePerson[];
  departments: TaskDepartment[];
  roles: { code: string; name_ar: string }[];
  allowEmpty?: boolean;
}) {
  const kind = value?.kind ?? (allowEmpty ? "" : "creator");
  const sel = "rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm";
  const set = (patch: Partial<TaskAssignRule>) =>
    onChange({ ...(value ?? { kind: "creator" }), ...patch } as TaskAssignRule);

  function pickKind(k: string) {
    if (!k) return onChange(null);
    const next: TaskAssignRule = { kind: k as TaskAssignRule["kind"] };
    if (k !== "creator") next.fallback = { kind: "creator" };
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={kind} onChange={(e) => pickKind(e.target.value)} className={sel} aria-label="طريقة الإسناد">
        {allowEmpty && <option value="">يرث من القالب</option>}
        {ASSIGN_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>

      {kind === "user" && (
        <select value={value?.user_id ?? ""} onChange={(e) => set({ user_id: e.target.value })} className={sel} aria-label="الموظف">
          <option value="">اختر…</option>
          {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
        </select>
      )}
      {kind === "role" && (
        <select value={value?.role_code ?? ""} onChange={(e) => set({ role_code: e.target.value })} className={sel} aria-label="الدور">
          <option value="">اختر دوراً…</option>
          {roles.map((r) => <option key={r.code} value={r.code}>{r.name_ar}</option>)}
        </select>
      )}
      {kind === "mkt_role" && (
        <select value={value?.mkt_role ?? ""} onChange={(e) => set({ mkt_role: e.target.value })} className={sel} aria-label="الدور التسويقي">
          <option value="">اختر…</option>
          {MKT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      )}
      {(kind === "department_manager" || kind === "round_robin" || kind === "least_loaded") && (
        <select value={value?.department_code ?? ""} onChange={(e) => set({ department_code: e.target.value || undefined })} className={sel} aria-label="القسم">
          <option value="">{kind === "department_manager" ? "قسم المهمة" : "اختر قسماً…"}</option>
          {departments.filter((d) => d.code).map((d) => <option key={d.id} value={d.code!}>{d.name_ar}</option>)}
        </select>
      )}
      {kind && kind !== "creator" && (
        <span className="text-[11px] text-gray-400">إن لم يوجد: من ينشئها</span>
      )}
    </div>
  );
}
