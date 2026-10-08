import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { getAssignablePeople, getTaskLookups } from "@/lib/tasks-server";
import { Task, taskOrigin } from "@/lib/types";
import TaskForm from "@/components/tasks/task-form";

// تعديل مهمة — النموذج لا يغيّر المسؤول إلا إن غيّره المستخدم فعلاً
export default async function EditTaskPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const supabase = await createClient();
  const [user, lookups, people] = await Promise.all([getCurrentUser(), getTaskLookups(), getAssignablePeople()]);

  const [{ data }, { data: links }] = await Promise.all([
    supabase.from("tasks").select("*").eq("id", params.id).maybeSingle(),
    supabase.from("task_label_links").select("label_id").eq("task_id", params.id),
  ]);
  if (!data) notFound();
  const task = data as Task;

  const { data: entityLabel } = task.entity_type && task.entity_id
    ? await supabase.rpc("task_entity_label", { p_type: task.entity_type, p_id: task.entity_id })
    : { data: null };
  const { data: reasonRequired } = await supabase.rpc("task_requires_cancel_reason", {
    p_type: task.task_type ?? "general", p_dept: task.department_id ?? null,
  });

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <header className="mb-5 flex items-center gap-3">
        <Link href={`/dashboard/tasks/${task.id}`} className="text-sm text-gray-500 hover:text-brand-700">← المهمة</Link>
        <h1 className="text-2xl font-bold text-ink">تعديل المهمة</h1>
      </header>

      <div className="mb-4 max-w-4xl rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-gray-400">person</span>
            {taskOrigin(task, user?.id ?? null)}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-gray-400">schedule</span>
            أُنشئت في {baghdadDate(task.created_at)}
          </span>
        </span>
      </div>

      <div className="max-w-4xl">
        <TaskForm
          task={task}
          labelsOfTask={((links ?? []) as { label_id: string }[]).map((l) => l.label_id)}
          people={people}
          departments={lookups.departments}
          types={lookups.types}
          entityTypes={lookups.entityTypes}
          labels={lookups.labels}
          workflows={lookups.workflows}
          projects={lookups.projects}
          todayISO={baghdadDate()}
          prefill={{ entity_label: (entityLabel as string | null) ?? undefined }}
          cancelReasonRequired={Boolean(reasonRequired)}
        />
      </div>
    </main>
  );
}
