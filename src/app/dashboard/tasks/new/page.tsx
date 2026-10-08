import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { baghdadDate } from "@/lib/time";
import { getAssignablePeople, getTaskLookups } from "@/lib/tasks-server";
import TaskForm, { type TaskFormPrefill } from "@/components/tasks/task-form";
import TemplatePicker from "@/components/tasks/template-picker";
import type { TaskTemplate } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// ============================================================
// مهمة جديدة — بالتفصيل، أو من قالب.
//
// الإنشاء الذكي: من العميل/الفرصة/المشروع/الحملة/الموظف يُملأ الربط،
// ويُقترح مالك الكيان مسؤولاً وقسمه قسماً (اقتراح لا فرض — يظهر في
// الحقل ويمكن تغييره، والقاعدة لا تقبل إلا من تملك إسناده).
// ============================================================
export default async function NewTaskPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient();
  const [lookups, people] = await Promise.all([getTaskLookups(), getAssignablePeople()]);
  const today = baghdadDate();

  const prefill: TaskFormPrefill = {};
  const et = one(searchParams.entity_type);
  const eid = one(searchParams.entity_id);
  const parent = one(searchParams.parent);
  const dept = one(searchParams.department_id) ?? one(searchParams.dept);
  const project = one(searchParams.project_id) ?? one(searchParams.project);
  const type = one(searchParams.task_type);

  if (dept && UUID.test(dept)) prefill.department_id = dept;
  if (project && UUID.test(project)) prefill.project_id = project;
  if (type && /^[a-z][a-z0-9_]*$/.test(type)) prefill.task_type = type;

  if (et && eid && UUID.test(eid) && lookups.entityTypes.some((e) => e.code === et)) {
    prefill.entity_type = et;
    prefill.entity_id = eid;
    const { data: label } = await supabase.rpc("task_entity_label", { p_type: et, p_id: eid });
    prefill.entity_label = (label as string | null) ?? undefined;

    // اقتراح المسؤول والقسم والمشروع من مالك الكيان
    let ownerEmp: string | null = null;
    if (et === "client") {
      const { data } = await supabase.from("clients").select("owner_id").eq("id", eid).maybeSingle();
      ownerEmp = (data as { owner_id: string | null } | null)?.owner_id ?? null;
    } else if (et === "opportunity") {
      const { data } = await supabase.from("opportunities").select("owner_id, project_id").eq("id", eid).maybeSingle();
      const o = data as { owner_id: string | null; project_id: string | null } | null;
      ownerEmp = o?.owner_id ?? null;
      if (o?.project_id && !prefill.project_id) prefill.project_id = o.project_id;
    } else if (et === "employee") {
      ownerEmp = eid;
    } else if (et === "project") {
      prefill.project_id = eid;
    }
    if (ownerEmp) {
      const { data: emp } = await supabase.from("employees").select("user_id, full_name, department_id").eq("id", ownerEmp).maybeSingle();
      const e = emp as { user_id: string | null; full_name: string; department_id: string | null } | null;
      if (e?.user_id && people.some((p) => p.user_id === e.user_id)) {
        prefill.assigned_to = e.user_id;
        prefill.suggestion = `مقترح: ${e.full_name} (${et === "employee" ? "الموظف نفسه" : "مالك " + (et === "client" ? "العميل" : "الفرصة")})`;
      }
      if (e?.department_id && !prefill.department_id && et !== "employee") prefill.department_id = e.department_id;
    }
  }

  if (parent && UUID.test(parent)) {
    const { data } = await supabase.from("tasks").select("id, title, department_id, project_id").eq("id", parent).maybeSingle();
    const p = data as { id: string; title: string; department_id: string | null; project_id: string | null } | null;
    if (p) {
      prefill.parent_task_id = p.id;
      prefill.parent_title = p.title;
      prefill.department_id ??= p.department_id ?? undefined;
      prefill.project_id ??= p.project_id ?? undefined;
    }
  }

  const { data: tplRaw } = await supabase.from("task_templates").select("id, name_ar, description, workspace, task_type")
    .eq("is_active", true).order("name_ar");
  const templates = (tplRaw ?? []) as Pick<TaskTemplate, "id" | "name_ar" | "description" | "workspace" | "task_type">[];

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <header className="mb-5 flex items-center gap-3">
        <Link href="/dashboard/tasks" className="text-sm text-gray-500 hover:text-brand-700">← المهام</Link>
        <h1 className="text-2xl font-bold text-ink">مهمة جديدة</h1>
      </header>

      <div className="grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <TaskForm
          people={people}
          departments={lookups.departments}
          types={lookups.types}
          entityTypes={lookups.entityTypes}
          labels={lookups.labels}
          workflows={lookups.workflows}
          projects={lookups.projects}
          todayISO={today}
          prefill={prefill}
        />
        {!prefill.parent_task_id && templates.length > 0 && (
          <TemplatePicker templates={templates} prefill={{
            entity_type: prefill.entity_type, entity_id: prefill.entity_id,
            department_id: prefill.department_id, project_id: prefill.project_id,
          }} />
        )}
      </div>
    </main>
  );
}
