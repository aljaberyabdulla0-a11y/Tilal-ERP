import { listTasks } from "@/lib/tasks-server";
import { withParams } from "@/lib/task-filters";
import TaskRowCard from "../task-row-card";
import { EmptyState, SectionTitle } from "../work-center-ui";

// ============================================================
// قسم مهام قائم بذاته: يجلب صفحته الأولى من task_list ويعرضها، ورابط
// «عرض الكل» يفتح القائمة بنفس المرشّح. كل قسم استعلام واحد محدود.
// ============================================================
export default async function TaskSection({
  title, icon, tone, payload, limit = 8, listParams, todayISO, myUserId,
  variant = "default", showAssignee = true, empty, hint,
}: {
  title: string;
  icon: string;
  tone?: string;
  payload: Record<string, unknown>;
  limit?: number;
  listParams: Record<string, string>;
  todayISO: string;
  myUserId: string;
  variant?: "default" | "sales" | "compact";
  showAssignee?: boolean;
  empty: string;
  hint?: string;
}) {
  const res = await listTasks(payload, limit);
  return (
    <section>
      <SectionTitle icon={icon} title={title} count={res.total} tone={tone}
        href={withParams("/dashboard/tasks", { ...listParams, view: "list" })} />
      {hint && <p className="-mt-1 mb-2 text-xs text-ink-muted">{hint}</p>}
      {res.rows.length ? (
        <div className="space-y-2.5">
          {res.rows.map((t) => (
            <TaskRowCard key={t.id} task={t} todayISO={todayISO} myUserId={myUserId} showAssignee={showAssignee} variant={variant} />
          ))}
        </div>
      ) : (
        <EmptyState icon={icon} text={empty} />
      )}
    </section>
  );
}
