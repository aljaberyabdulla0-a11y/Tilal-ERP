import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getUserRole } from "@/lib/auth";
import { BUILDER_ROLES, fixedFiltersOf, getMetricDefs, getReportTemplate } from "@/lib/crm-reporting";
import { getProjectsLite } from "@/lib/crm";
import CrmTabs from "../../crm-tabs";
import ReportBuilder, { type BuilderDraft } from "./report-builder";

// منشئ التقارير (§21) — للمدير ومدير المتابعة والمشرف (سياسة 099).
// ?from=<قالب>: نسخ قالب (نظامي أو لغيري) أو تعديل قالبي.
export default async function Builder({ searchParams }: { searchParams: { from?: string } }) {
  const role = await getUserRole();
  if (!BUILDER_ROLES.includes(role)) redirect("/dashboard/crm/reports");

  const [user, metrics, projects, source] = await Promise.all([
    getCurrentUser(), getMetricDefs(), getProjectsLite(),
    searchParams.from ? getReportTemplate(searchParams.from) : Promise.resolve(null),
  ]);
  const { team: fixedTeams = [], project: fixedProjects = [], ...otherFixed } = fixedFiltersOf(source);
  const scopeBy: "team" | "project" = fixedProjects.length && !fixedTeams.length ? "project" : "team";
  const mine = !!source && !source.is_system && source.created_by === user?.id;

  const initial: BuilderDraft = source && !source.definition.link
    ? {
        id: mine ? source.id : undefined,
        name: mine ? source.name : `${source.name} (نسخة)`,
        description: source.description ?? "",
        category: source.is_system ? "مخصّص" : source.category,
        is_shared: mine ? source.is_shared : false,
        audience: source.audience,
        default_range: source.definition.default_range ?? "last_7",
        compare: source.definition.compare ?? "previous_period",
        basis: source.definition.basis ?? "event",
        projects: scopeBy === "team" ? fixedTeams : fixedProjects,
        scopeBy,
        // إن ثُبِّت الاثنان معاً (يدوياً في القالب) يُحفظ غير المعروض كما هو
        otherFilters: { ...(otherFixed as Record<string, string[]>), ...(scopeBy === "team" && fixedProjects.length ? { project: fixedProjects } : {}) },
        sections: source.definition.sections.map((s) => ({
          key: s.key, title: s.title, type: s.type,
          metrics: s.metrics ?? [], group_by: s.group_by ?? [], sort: s.sort, state: s.state,
        })),
      }
    : {
        name: "", description: "", category: "مخصّص", is_shared: false,
        audience: ["admin", "followup_manager", "supervisor"], default_range: "last_7",
        compare: "previous_period", basis: "event", projects: [], scopeBy: "team", otherFilters: {},
        sections: [{ key: "summary", title: "الملخّص", type: "kpis", metrics: ["TOTAL_ACTIVITIES", "UNIQUE_CLIENTS_CONTACTED", "NEW_LEADS", "WON_DEALS"], group_by: [] }],
      };

  return (
    <div>
      <CrmTabs active="reports" />
      <div className="space-y-4 p-6">
        <Link href="/dashboard/crm/reports" className="text-sm text-brand-700 hover:underline">← التقارير</Link>
        <h1 className="text-xl font-bold text-brand-600">{initial.id ? `تعديل «${initial.name}»` : "منشئ التقارير"}</h1>
        <p className="text-sm text-gray-500">
          المقاييس من السجلّ الموحّد (<Link href="/dashboard/crm/reports/metrics" className="text-brand-700 hover:underline">تعريفاتها</Link>) —
          التقرير الجديد يحسب بنفس التعريف الذي يحسب به كل تقرير آخر.
        </p>
        <ReportBuilder
          metrics={metrics.map((m) => ({ code: m.code, name_ar: m.name_ar, category: m.category, source: m.source, definition: m.definition }))}
          projects={projects}
          initial={initial}
          canUpdate={mine}
        />
      </div>
    </div>
  );
}
