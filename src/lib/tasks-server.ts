import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type {
  AssignablePerson,
  TaskCounts,
  TaskDepartment,
  TaskDepartmentOverviewRow,
  TaskDetail,
  TaskEntityTypeDef,
  TaskLabel,
  TaskListResult,
  TaskOverview,
  TaskSourceDef,
  TaskTypeDef,
  TaskWorkflow,
  TaskWorkflowStep,
  TaskWorkloadRow,
  TaskWorkspace,
} from "@/lib/types";

// ============================================================
// قراءات المهام من الخادم — كلها عبر دوال القاعدة (191/193) أو جداول
// المراجع، وRLS تحدّد ما يُرى. لا حساب للأرقام في TypeScript: الصفحة
// تعرض ما تعيده القاعدة.
//
// الفشل لا يكسر الصفحة: إن لم تُطبَّق 189–193 بعد تعود القوائم فارغة
// ويظهر تنبيه «لم تُفعَّل المهام V2» (notReady).
// ============================================================

export type TaskLookups = {
  ready: boolean;
  types: TaskTypeDef[];
  sources: TaskSourceDef[];
  workspaces: TaskWorkspace[];
  entityTypes: TaskEntityTypeDef[];
  departments: TaskDepartment[];
  labels: TaskLabel[];
  workflows: TaskWorkflow[];
  projects: { id: string; name: string }[];
};

export const getTaskLookups = cache(async (): Promise<TaskLookups> => {
  const supabase = await createClient();
  const [types, sources, workspaces, entityTypes, depts, settings, labels, workflows, steps, projects] = await Promise.all([
    supabase.from("task_types").select("*").order("sort_order"),
    supabase.from("task_sources").select("*").order("sort_order"),
    supabase.from("task_workspaces").select("*").order("sort_order"),
    supabase.from("task_entity_types").select("*").order("sort_order"),
    supabase.from("departments").select("id, code, name_ar, parent_id, status, sort_order").order("sort_order"),
    supabase.from("department_task_settings").select("*"),
    supabase.from("task_labels").select("id, name, color, department_id, is_active").eq("is_active", true).order("name"),
    supabase.from("task_workflows").select("*").eq("is_active", true).order("name_ar"),
    supabase.from("task_workflow_steps").select("*").order("position"),
    supabase.from("projects").select("id, name").order("name"),
  ]);

  const ready = !types.error;
  const settingsBy = new Map(
    ((settings.data ?? []) as {
      department_id: string; workspace: string; due_soon_hours: number;
      requires_cancel_reason: boolean; default_workflow_id: string | null;
    }[]).map((s) => [s.department_id, s]),
  );
  type DeptRow = { id: string; code: string | null; name_ar: string; parent_id: string | null; status: string };
  const rawDepts = ((depts.data ?? []) as DeptRow[]).filter((d) => d.status !== "مؤرشف");
  const byId = new Map(rawDepts.map((d) => [d.id, d]));
  // الإعداد يرث من الأب (مثل task_department_settings في القاعدة)
  const inherited = (id: string) => {
    let cur: DeptRow | undefined = byId.get(id);
    for (let i = 0; cur && i < 10; i++) {
      const s = settingsBy.get(cur.id);
      if (s) return s;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return undefined;
  };
  const departments: TaskDepartment[] = rawDepts.map((d) => {
    const s = inherited(d.id);
    return {
      id: d.id,
      code: d.code,
      name_ar: d.name_ar,
      parent_id: d.parent_id,
      workspace: s?.workspace ?? null,
      due_soon_hours: s?.due_soon_hours ?? null,
      requires_cancel_reason: s?.requires_cancel_reason ?? false,
      default_workflow_id: s?.default_workflow_id ?? null,
    };
  });

  const allSteps = (steps.data ?? []) as TaskWorkflowStep[];
  const wfs = ((workflows.data ?? []) as Omit<TaskWorkflow, "steps">[]).map((w) => ({
    ...w,
    steps: allSteps.filter((s) => s.workflow_id === w.id),
  }));

  return {
    ready,
    types: (types.data ?? []) as TaskTypeDef[],
    sources: (sources.data ?? []) as TaskSourceDef[],
    workspaces: ((workspaces.data ?? []) as TaskWorkspace[]).filter((w) => w.is_active),
    entityTypes: (entityTypes.data ?? []) as TaskEntityTypeDef[],
    departments,
    labels: (labels.data ?? []) as TaskLabel[],
    workflows: wfs,
    projects: (projects.data ?? []) as { id: string; name: string }[],
  };
});

export async function listTasks(
  payload: Record<string, unknown>,
  limit = 50,
  offset = 0,
): Promise<TaskListResult & { error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("task_list", { p: payload, p_limit: limit, p_offset: offset });
  if (error) {
    console.error("task_list", error);
    return { rows: [], total: 0, error: error.message };
  }
  const r = (data ?? { rows: [], total: 0 }) as TaskListResult;
  return { rows: r.rows ?? [], total: Number(r.total ?? 0), error: null };
}

export const getTaskCounts = cache(async (): Promise<TaskCounts | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("task_counts");
  if (error) {
    console.error("task_counts", error);
    return null;
  }
  return data as TaskCounts | null;
});

export async function getTaskDetail(id: string): Promise<TaskDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("task_detail", { p_id: id });
  if (error) {
    console.error("task_detail", error);
    return null;
  }
  return (data as TaskDetail | null) ?? null;
}

export const getAssignablePeople = cache(async (): Promise<AssignablePerson[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("task_assignable_people");
  if (error) {
    console.error("task_assignable_people", error);
    return [];
  }
  return (data ?? []) as AssignablePerson[];
});

export async function getTaskOverview(from: string, to: string, filters: Record<string, unknown> = {}): Promise<TaskOverview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("task_overview", { p_from: from, p_to: to, p: filters });
  if (error) {
    console.error("task_overview", error);
    return null;
  }
  return data as TaskOverview;
}

export async function getTaskWorkload(department: string | null = null): Promise<TaskWorkloadRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("task_workload", { p_department: department });
  if (error) {
    console.error("task_workload", error);
    return [];
  }
  return (data ?? []) as TaskWorkloadRow[];
}

export async function getDepartmentOverview(): Promise<TaskDepartmentOverviewRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("task_department_overview");
  if (error) {
    console.error("task_department_overview", error);
    return [];
  }
  return (data ?? []) as TaskDepartmentOverviewRow[];
}

export async function getRelatedSummary(entityType: string, entityId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("task_related_summary", { p_entity_type: entityType, p_entity_id: entityId });
  if (error) return null;
  return data as { open: number; overdue: number; completed: number; total: number; completion_pct: number | null } | null;
}

export async function canManageTaskConfig(departmentId: string | null = null): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("task_can_manage_config", { p_dept: departmentId });
  return Boolean(data);
}
