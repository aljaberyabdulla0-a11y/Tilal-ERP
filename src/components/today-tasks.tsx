import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Task } from "@/lib/types";
import { groupTasks } from "@/lib/tasks";
import { baghdadDate } from "@/lib/time";
import TaskCard from "@/app/dashboard/tasks/task-card";

// ============================================================
// بطاقة «مهامي اليوم» في لوحة التحكم — أول ما يراه الموظف صباحاً.
// تعرض المتأخرة أولاً ثم مهام اليوم، وللمدير سطراً عن متأخرات الفريق.
// ============================================================
export default async function TodayTasks() {
  const supabase = await createClient();
  const [user, admin] = await Promise.all([getCurrentUser(), isAdmin()]);
  const myUserId = user?.id ?? "";
  const today = baghdadDate();

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("assigned_to", myUserId)
    .in("status", ["جديدة", "قيد التنفيذ"])
    .lte("due_date", today)
    .order("due_date", { ascending: true })
    .limit(30);

  // جدول المهام غير موجود بعد (لم يُشغَّل sql/031) — لا نكسر اللوحة
  if (error) return null;

  const tasks = (data ?? []) as Task[];
  const groups = groupTasks(tasks, today);
  const list = [...groups.late, ...groups.today];

  // للمدير: كم مهمة متأخرة عند بقية الفريق
  let teamLate = 0;
  if (admin) {
    const { count } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .in("status", ["جديدة", "قيد التنفيذ"])
      .lt("due_date", today)
      .neq("assigned_to", myUserId);
    teamLate = count ?? 0;
  }

  return (
    <div className="glass-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-lg font-bold text-brand-900">
          <span className="material-symbols-outlined text-brand-600">checklist</span>
          مهامي اليوم
          {list.length > 0 && (
            <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">
              {list.length}
            </span>
          )}
        </h4>
        <Link
          href="/dashboard/tasks"
          className="text-sm font-bold text-brand-700 hover:underline"
        >
          كل المهام
        </Link>
      </div>

      {groups.late.length > 0 && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          عندك {groups.late.length} مهمة متأخرة — ابدأ بها.
        </p>
      )}

      {list.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-gray-400">لا توجد مهام مستحقة اليوم 🎉</p>
          <Link
            href="/dashboard/tasks/new"
            className="mt-3 inline-block rounded-xl bg-gray-50 px-4 py-2 text-sm font-medium text-brand-700 transition hover:bg-brand-50"
          >
            + أضف مهمة لنفسك
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.slice(0, 6).map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              myUserId={myUserId}
              todayISO={today}
              compact
            />
          ))}
          {list.length > 6 && (
            <Link
              href="/dashboard/tasks"
              className="block pt-1 text-center text-sm font-medium text-brand-700 hover:underline"
            >
              وعندك {list.length - 6} مهمة أخرى…
            </Link>
          )}
        </div>
      )}

      {admin && teamLate > 0 && (
        <Link
          href="/dashboard/tasks"
          className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
        >
          <span className="material-symbols-outlined text-[18px]">groups</span>
          {teamLate} مهمة متأخرة عند الفريق
        </Link>
      )}
    </div>
  );
}
