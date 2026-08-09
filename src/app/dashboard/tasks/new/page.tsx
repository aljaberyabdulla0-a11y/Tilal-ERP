import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getPeople } from "@/lib/people";
import TaskForm from "../task-form";

// صفحة إضافة مهمة بالتفصيل
export default async function NewTaskPage() {
  const supabase = await createClient();
  const [user, admin, people] = await Promise.all([
    getCurrentUser(),
    isAdmin(),
    getPeople(),
  ]);

  // العملاء المتاحون لي (حماية الصفوف تحدّد ما أراه)
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .order("name")
    .limit(500);

  return (
    <main className="p-6 lg:p-8">
      <header className="mb-6 flex items-center gap-3">
        <Link
          href="/dashboard/tasks"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← المهام
        </Link>
        <h1 className="text-2xl font-bold text-brand-900">مهمة جديدة</h1>
      </header>

      <div className="max-w-3xl">
        <TaskForm
          people={people}
          clients={(clients ?? []) as { id: string; name: string }[]}
          myUserId={user?.id ?? ""}
          isAdmin={admin}
        />
      </div>
    </main>
  );
}
