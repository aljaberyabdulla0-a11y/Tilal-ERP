import { getI18n } from "@/lib/i18n/server";
import { getHrDashboard } from "@/lib/hr-reports";
import { DashboardSection, StatTile } from "@/components/dashboard/ui";
import { ErrorState } from "@/components/dashboard/states";

// ============================================================
// لمحة HR — من hr_dashboard (165) كما هي: الحضور والغياب والتأخّر
// اليوم بتوقيت بغداد، والإجازات والطلبات المعلّقة. صلاحياتها داخلها
// (HR والمدراء)، فإن رفضت لدورٍ ظهر القسم «غير متاح» لا صفراً.
// ============================================================

export default async function HrSection() {
  const { t } = getI18n();
  const s = t.dash.sections;
  const k = t.dash.kpi;
  const { data, error } = await getHrDashboard();

  return (
    <DashboardSection id="hr" title={s.hr} hint={s.hrHint} href="/dashboard/hr" linkLabel={t.dash.common.viewAll}>
      {!data ? (
        <ErrorState compact detail={error ?? undefined} />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <StatTile label={k.activeEmployees} value={data.active} href="/dashboard/hr/employees" />
          <StatTile label={k.presentToday} value={data.present_today} tone="good" href="/dashboard/hr/attendance" />
          <StatTile label={k.absentToday} value={data.absent_today} tone={data.absent_today > 0 ? "danger" : "neutral"} href="/dashboard/hr/attendance" />
          <StatTile label={k.lateToday} value={data.late_today} tone={data.late_today > 0 ? "warning" : "neutral"} href="/dashboard/hr/attendance" />
          <StatTile label={k.onLeave} value={data.on_leave_today} href="/dashboard/hr/leaves" />
          <StatTile label={k.pendingLeaves} value={data.pending_leaves} tone={data.pending_leaves > 0 ? "warning" : "neutral"} href="/dashboard/hr/leaves" />
          <StatTile label={k.probationEnding} value={data.probation_ending} tone={data.probation_ending > 0 ? "warning" : "neutral"} href="/dashboard/hr/probation" />
          <StatTile label={k.pendingApprovals} value={data.pending_expenses + data.pending_advances + data.pending_overtime} href="/dashboard/me/approvals" />
        </div>
      )}
    </DashboardSection>
  );
}
