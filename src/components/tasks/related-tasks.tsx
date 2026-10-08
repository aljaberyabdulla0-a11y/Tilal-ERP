import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { baghdadDate } from "@/lib/time";
import { getRelatedSummary, listTasks } from "@/lib/tasks-server";
import TaskRowCard from "./task-row-card";

const FILTER_KEY: Record<string, string> = {
  client: "client_id", opportunity: "opportunity_id", project: "project_id", campaign: "campaign_id",
};
const LIST_PARAM: Record<string, string> = {
  client: "client", opportunity: "opportunity", project: "project", campaign: "campaign",
};

// ============================================================
// «المهام المرتبطة» داخل العميل والفرصة والموظف والحملة والمشروع —
// ينشئ ويُنجز ويؤجّل دون الذهاب إلى صفحة المهام.
// RLS تحدّد ما يُعرض: من يرى العميل لا يرى بالضرورة كل مهامه.
// ============================================================
export default async function RelatedTasks({
  entityType, entityId, title = "المهام المرتبطة", variant = "default", limit = 6,
}: {
  entityType: "client" | "opportunity" | "employee" | "project" | "campaign";
  entityId: string;
  title?: string;
  variant?: "default" | "sales";
  limit?: number;
}) {
  // الموظف: ما أُسند إلى حسابه (وهو ما تعدّه task_related_summary)
  let empUser: string | null = null;
  if (entityType === "employee") {
    const supabase = await createClient();
    const { data } = await supabase.from("employees").select("user_id").eq("id", entityId).maybeSingle();
    empUser = (data as { user_id: string | null } | null)?.user_id ?? null;
    if (!empUser) return null;
  }
  const payload: Record<string, unknown> =
    entityType === "employee" ? { assigned_to: empUser } : { [FILTER_KEY[entityType]]: entityId };
  const [user, summary, open] = await Promise.all([
    getCurrentUser(),
    getRelatedSummary(entityType, entityId),
    listTasks({ ...payload, bucket: "open", sort: "due" }, limit),
  ]);
  if (summary == null && open.error) return null;   // V2 غير مطبّقة بعد

  const today = baghdadDate();
  const allHref = entityType === "employee"
    ? `/dashboard/tasks?view=list&bucket=open&assignee=${empUser}`
    : `/dashboard/tasks?view=list&${LIST_PARAM[entityType]}=${entityId}`;
  const newHref = entityType === "project"
    ? `/dashboard/tasks/new?project_id=${entityId}`
    : `/dashboard/tasks/new?entity_type=${entityType}&entity_id=${entityId}`;

  return (
    <section className="dash-card p-4" aria-label={title}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold text-ink">
          <span aria-hidden="true" className="material-symbols-outlined text-brand-600">task_alt</span>{title}
        </h2>
        <div className="flex items-center gap-2">
          {open.total > 0 && <Link href={allHref} className="text-xs font-medium text-brand-700 hover:underline">الكل</Link>}
          <Link href={newHref} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">+ مهمة</Link>
        </div>
      </header>

      {summary && summary.total > 0 && (
        <div className="mb-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
            <span>مفتوحة <b className="text-ink">{summary.open}</b></span>
            <span>متأخرة <b className={summary.overdue ? "text-red-700" : "text-ink"}>{summary.overdue}</b></span>
            <span>منجزة <b className="text-ink">{summary.completed}</b></span>
            {summary.completion_pct != null && <span>الإنجاز <b className="text-ink" dir="ltr">{summary.completion_pct}%</b></span>}
          </div>
          {summary.completion_pct != null && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${summary.completion_pct}%` }} />
            </div>
          )}
        </div>
      )}

      {open.rows.length ? (
        <div className="space-y-2">
          {open.rows.map((t) => (
            <TaskRowCard key={t.id} task={t} todayISO={today} myUserId={user?.id ?? ""} showAssignee variant={variant} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">لا مهام مفتوحة.</p>
      )}
    </section>
  );
}
