import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { getMyViews } from "@/lib/dashboard/data";
import { fill } from "@/lib/dashboard/format";
import { PORTAL_VIEWS, pickView, type DashView } from "@/lib/dashboard/views";
import type { RawParams } from "@/lib/dashboard/period";
import { MismatchBanner, ViewTabs } from "@/components/dashboard/view-tabs";
import { Icon } from "@/components/dashboard/ui";
import ExecutiveDashboard from "./_views/executive";
import SupervisorDashboard from "./_views/supervisor";
import MarketingDashboard from "./_views/marketing";
import ViewerDashboard from "./_views/viewer";
import EmployeeDashboard from "./_views/employee";
import FollowupDashboard from "./_views/followup";
import BrokerDashboard from "./_views/broker";
import RmDashboard from "./_views/rm";

// ============================================================
// /dashboard — لوحة لكل شخص.
//
// من يرى ماذا تقرّره القاعدة (my_dashboard_views — sql/184):
//   • الدور الصريح (مدير، وسيط، محاسب، HR، مُطالِع، تسويق، متابعة، علاقات)
//   • وللموظف والمشرف: منصبه في HR — مديرة التسويق تفتح التسويق،
//     ومديرة المتابعة المتابعة، وموظف المبيعات مبيعاته
//   • وألسنة من العلاقات: مدير علاقات وسيط ← «الوساطة»، مشرف ← «فريقي»،
//     عضو فريق التسويق ← «التسويق»، له ليدات ← «مبيعاتي»
//   • والمدير يرى كل اللوحات، ويخصّص لأي شخص (/dashboard/settings/dashboards)
//
//   ?view=<لوحة>  ينتقل بين لوحات الشخص — ولا يفتح لوحة ليست له.
//
// ⚠️ اختيار اللوحة عرضٌ لا صلاحية: كل رقم في كل لوحة تقيّده سياسات
//    القاعدة (RLS ودوال can_*). ومنصبٌ يقترح دوراً أوسع من دور الحساب
//    يُنبَّه إليه بدل عرض أقسامٍ فارغة كأنها أصفار.
// ============================================================

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function renderView(view: DashView, searchParams: RawParams) {
  switch (view) {
    case "executive": return <ExecutiveDashboard searchParams={searchParams} />;
    case "team": return <SupervisorDashboard searchParams={searchParams} />;
    case "marketing": return <MarketingDashboard searchParams={searchParams} />;
    case "viewer": return <ViewerDashboard searchParams={searchParams} />;
    case "followup": return <FollowupDashboard />;
    case "rm": return <RmDashboard />;
    case "broker": return <BrokerDashboard />;
    default: return <EmployeeDashboard />;
  }
}

export default async function DashboardPage({ searchParams }: { searchParams: RawParams }) {
  const role = await getUserRole();
  const info = await getMyViews(role);
  const current = pickView(info, one(searchParams.view));

  // ============================================================
  // ليس له إلا بوابة (المحاسب ← المالية، HR ← الموارد البشرية): يُفتح
  // عليها رأساً كما كان (sql/068). إلا إن كان منصبه يقترحها ودوره لا
  // يفتحها — فالتحويل إلى شاشةٍ ترفضه أسوأ من قولها صراحةً.
  // ============================================================
  if (!current) {
    const portal = PORTAL_VIEWS[info.primary];
    if (portal && !info.mismatch) redirect(portal);
    return <NoDashboard info={info} />;
  }

  const keep = {
    range: one(searchParams.range), from: one(searchParams.from),
    to: one(searchParams.to), project: one(searchParams.project),
  };
  const multi = info.views.length > 1;

  return (
    <>
      {(multi || (info.mismatch && current === info.primary)) && (
        <div className="mx-auto w-full max-w-[1600px] px-4 pt-4 sm:px-6 lg:px-8">
          <ViewTabs info={info} current={current} keep={keep} />
          {info.mismatch && current === info.primary && <div className="mt-3"><MismatchBanner info={info} admin={role === "admin"} /></div>}
        </div>
      )}
      {renderView(current, searchParams)}
    </>
  );
}

function NoDashboard({ info }: { info: Parameters<typeof MismatchBanner>[0]["info"] }) {
  const { t } = getI18n();
  const label = t.dash.views[info.primary];
  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <MismatchBanner info={info} admin={false} />
      <div className="dash-card p-6 text-center">
        <Icon name="lock_person" className="text-4xl text-ink-muted" />
        <p className="mt-2 text-sm text-ink-secondary">{fill(t.dash.persona.portalOnly, { view: label })}</p>
        <Link href="/dashboard/me" className="dash-focus mt-4 inline-flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          <Icon name="badge" className="text-[18px]" />
          {t.nav.hr}
        </Link>
      </div>
    </main>
  );
}
