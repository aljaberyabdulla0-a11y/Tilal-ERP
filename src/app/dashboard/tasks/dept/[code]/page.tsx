import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { getAssignablePeople, getDepartmentOverview, getTaskLookups } from "@/lib/tasks-server";
import QuickAdd from "@/components/tasks/quick-add";
import { KpiGrid, NotReady } from "@/components/tasks/work-center-ui";
import SalesWorkspace from "@/components/tasks/workspaces/sales-workspace";
import MarketingWorkspace from "@/components/tasks/workspaces/marketing-workspace";
import { AccountingWorkspace, GenericWorkspace, HrWorkspace } from "@/components/tasks/workspaces/sections-workspaces";

// ============================================================
// مساحة القسم — /dashboard/tasks/dept/{رمز القسم}
//
// التخطيط من البيانات لا من الكود: department_task_settings.workspace
// → task_workspaces.layout (sales | marketing | hr | accounting | generic).
// قسم جديد يأخذ «generic» بلا سطر كود، وتغيير مساحة قسم = تعديل صفّ.
// المهام المعروضة = ما تسمح به RLS للسائل داخل مساحة القسم.
// ============================================================
export default async function DepartmentWorkspacePage({
  params, searchParams,
}: {
  params: { code: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const code = decodeURIComponent(params.code);
  const [user, lookups, people, overview] = await Promise.all([
    getCurrentUser(), getTaskLookups(), getAssignablePeople(), getDepartmentOverview(),
  ]);
  if (!lookups.ready) {
    return <main className="p-6"><NotReady /></main>;
  }
  const dept = lookups.departments.find((d) => d.code === code);
  if (!dept) notFound();

  const ws = lookups.workspaces.find((w) => w.code === dept.workspace);
  const layout = ws?.layout ?? "generic";
  const today = baghdadDate();
  const myUserId = user?.id ?? "";
  const ov = overview.find((o) => o.department_id === dept.id);
  const basePath = `/dashboard/tasks/dept/${encodeURIComponent(code)}`;
  const tab = typeof searchParams.tab === "string" ? searchParams.tab : "";

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <nav className="mb-2 text-sm text-gray-500" aria-label="مسار التنقّل">
        <Link href="/dashboard/tasks" className="hover:text-brand-700">المهام</Link> ‹ {dept.name_ar}
      </nav>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink sm:text-3xl">
            <span aria-hidden="true" className="material-symbols-outlined text-[30px] text-brand-600">{ws?.icon ?? "apartment"}</span>
            {dept.name_ar}
          </h1>
          <p className="mt-1 text-ink-muted">مساحة {ws?.name_ar ?? "عمل"} — ما في نطاقك من مهام القسم.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/dashboard/tasks/templates?workspace=${dept.workspace ?? ""}`} className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-brand-500">القوالب</Link>
          <Link href={`/dashboard/tasks/reports?dept=${dept.id}`} className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-brand-500">تقرير القسم</Link>
          <Link href={`/dashboard/tasks/new?department_id=${dept.id}`} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">+ مهمة</Link>
        </div>
      </header>

      {ov && (
        <KpiGrid items={[
          { label: "مفتوحة", value: ov.open_count, icon: "inbox", tone: "bg-brand-50 text-brand-700", href: `/dashboard/tasks?view=list&dept=${dept.id}&bucket=open` },
          { label: "متأخرة", value: ov.late_count, icon: "warning", tone: "bg-red-50 text-red-700", href: `/dashboard/tasks?view=list&dept=${dept.id}&bucket=late` },
          { label: "اليوم", value: ov.today_count, icon: "today", tone: "bg-amber-50 text-amber-700", href: `/dashboard/tasks?view=list&dept=${dept.id}&bucket=today` },
          { label: "أُنجزت اليوم", value: ov.done_today, icon: "check_circle", tone: "bg-emerald-50 text-emerald-700" },
          { label: "بانتظار الموافقة", value: ov.pending_approval_count, icon: "verified", tone: "bg-purple-50 text-purple-700", href: `/dashboard/tasks?view=list&dept=${dept.id}&bucket=pending_approval` },
          { label: "الإنجاز (٣٠ يوماً)", value: ov.completion_rate_30d == null ? "—" : `${ov.completion_rate_30d}%`, icon: "trending_up", tone: "bg-gray-100 text-gray-700" },
        ]} />
      )}

      <div className="mb-6">
        <QuickAdd people={people} departments={lookups.departments} todayISO={today}
          defaults={{ department_id: dept.id, task_type: layout === "marketing" ? "content" : undefined }} />
      </div>

      {layout === "sales" && <SalesWorkspace todayISO={today} myUserId={myUserId} />}
      {layout === "marketing" && (
        <MarketingWorkspace tab={tab} todayISO={today} myUserId={myUserId} deptId={dept.id} lookups={lookups}
          people={people} searchParams={searchParams} basePath={basePath} />
      )}
      {layout === "hr" && <HrWorkspace todayISO={today} myUserId={myUserId} />}
      {layout === "accounting" && <AccountingWorkspace todayISO={today} myUserId={myUserId} />}
      {(layout === "generic" || layout === "projects") && <GenericWorkspace deptId={dept.id} todayISO={today} myUserId={myUserId} />}
    </main>
  );
}
