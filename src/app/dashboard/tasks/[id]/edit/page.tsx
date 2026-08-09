import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getPeople } from "@/lib/people";
import { Task, taskOrigin } from "@/lib/types";
import TaskForm from "../../task-form";

// تعديل مهمة
export default async function EditTaskPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createClient();
  const [user, admin, people] = await Promise.all([
    getCurrentUser(),
    isAdmin(),
    getPeople(),
  ]);

  const [{ data }, { data: clients }] = await Promise.all([
    supabase.from("tasks").select("*").eq("id", params.id).maybeSingle(),
    supabase.from("clients").select("id, name").order("name").limit(500),
  ]);

  if (!data) notFound();
  const task = data as Task;

  return (
    <main className="p-6 lg:p-8">
      <header className="mb-6 flex items-center gap-3">
        <Link href="/dashboard/tasks" className="text-sm text-gray-500 hover:text-brand-700">
          ← المهام
        </Link>
        <h1 className="text-2xl font-bold text-brand-900">تعديل المهمة</h1>
      </header>

      {/* من طلب هذه المهمة ومتى — معلومة ثابتة لا تُعدَّل */}
      <div className="mb-4 max-w-3xl rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[17px] text-gray-400">person</span>
            {taskOrigin(task, user?.id ?? null)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[17px] text-gray-400">schedule</span>
            أُنشئت في {new Date(task.created_at).toLocaleDateString("ar")}
          </span>
        </span>
      </div>

      <div className="max-w-3xl">
        <TaskForm
          task={task}
          people={people}
          clients={(clients ?? []) as { id: string; name: string }[]}
          myUserId={user?.id ?? ""}
          isAdmin={admin}
        />
      </div>
    </main>
  );
}
