import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { baghdadDate } from "@/lib/time";
import { canManageTaskConfig, getAssignablePeople, getTaskLookups } from "@/lib/tasks-server";
import { NotReady } from "@/components/tasks/work-center-ui";
import {
  AutomationPanel, DepartmentSettingsPanel, LabelsPanel, RecurrencesPanel, TaskTypesPanel,
} from "@/components/tasks/settings-panels";
import type { TaskAutomationRule, TaskRecurrence, TaskTypeDef } from "@/lib/types";

// ============================================================
// إعدادات المهام — للمدير ومن يملك «إدارة المهام» (المصفوفة 146).
// التكرار متاح لكل مستخدم لمهامه هو (سياسات 190).
// الحماية في RLS؛ إخفاء الأقسام هنا للوضوح لا للأمان.
// ============================================================
export default async function TaskSettingsPage() {
  const supabase = await createClient();
  const [lookups, people, canManage] = await Promise.all([getTaskLookups(), getAssignablePeople(), canManageTaskConfig(null)]);

  const [{ data: allTypes }, { data: recs }, { data: tpls }, { data: rules }, { data: runs }, { data: own }, { data: roles }] = await Promise.all([
    supabase.from("task_types").select("*").order("sort_order"),
    supabase.from("task_recurrences").select("*").order("created_at", { ascending: false }),
    supabase.from("task_templates").select("id, name_ar").eq("is_active", true).order("name_ar"),
    canManage ? supabase.from("task_automation_rules").select("*").order("name_ar") : Promise.resolve({ data: [] }),
    canManage ? supabase.from("task_automation_runs").select("rule_id, status, created_at").order("created_at", { ascending: false }).limit(1000) : Promise.resolve({ data: [] }),
    supabase.from("department_task_settings").select("department_id"),
    supabase.from("roles").select("code, name_ar").eq("status", "نشط").order("sort_order"),
  ]);

  const runStats: Record<string, { ok: number; error: number; last: string | null }> = {};
  for (const r of (runs ?? []) as { rule_id: string; status: string; created_at: string }[]) {
    const s = (runStats[r.rule_id] ??= { ok: 0, error: 0, last: r.created_at });
    if (r.status === "ok") s.ok += 1;
    else if (r.status === "error") s.error += 1;
  }

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <nav className="mb-2 text-sm text-gray-500" aria-label="مسار التنقّل">
        <Link href="/dashboard/tasks" className="hover:text-brand-700">المهام</Link> ‹ الإعدادات
      </nav>
      <h1 className="mb-5 text-2xl font-bold text-ink sm:text-3xl">إعدادات المهام</h1>
      {!lookups.ready && <NotReady />}

      <div className="space-y-6">
        <RecurrencesPanel rows={(recs ?? []) as TaskRecurrence[]} people={people} departments={lookups.departments}
          types={lookups.types} templates={(tpls ?? []) as { id: string; name_ar: string }[]}
          roles={(roles ?? []) as { code: string; name_ar: string }[]} todayISO={baghdadDate()} />

        {canManage ? (
          <>
            <AutomationPanel rules={(rules ?? []) as TaskAutomationRule[]} templates={(tpls ?? []) as { id: string; name_ar: string }[]} runs={runStats} />
            <DepartmentSettingsPanel departments={lookups.departments} workspaces={lookups.workspaces} workflows={lookups.workflows}
              ownRows={((own ?? []) as { department_id: string }[]).map((r) => r.department_id)} />
            <TaskTypesPanel types={(allTypes ?? []) as TaskTypeDef[]} workspaces={lookups.workspaces} />
            <LabelsPanel labels={lookups.labels} departments={lookups.departments} />
          </>
        ) : (
          <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
            الأنواع والوسوم وإعداد الأقسام والأتمتة يديرها المدير ومن يملك صلاحية «إدارة المهام».
          </p>
        )}
      </div>
    </main>
  );
}
