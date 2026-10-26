import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { Client } from "@/lib/types";
import CrmTabs from "../../crm/crm-tabs";
import SalesBoard, { type BoardColumnMeta } from "./sales-board";
import { getPipelineConfig } from "@/lib/crm-config";
import { getClientFilterOptions, getProjectsLite } from "@/lib/crm";
import { baghdadDate } from "@/lib/time";
import ProjectTabs from "@/components/project-tabs";

// ============================================================
// لوحة مسار العملاء (Kanban) — كل عميل في مرحلة مساره الحالي (201).
//
// كانت تجلب select * بلا ترقيم، وPostgREST يقطع عند ١٠٠٠ صفّ: مع
// ١٤١٨ عميلاً غاب ٤١٨ عن اللوحة ولا شيء يقول ذلك. الآن:
//   • المراحل المفتوحة تُجلب كاملةً بالصفحات — هي ما يُعمل عليه.
//   • المغلقة (بيع، فشل، ختامية غير تجارية) آخر CLOSED_LIMIT منها
//     بالعدد الحقيقي ورابطٍ إلى القائمة المرشَّحة.
// فلا يغيب عميل مفتوح، ولا يُعرض عمود مقطوع بلا أن يُقال إنه مقطوع.
// ============================================================
const PAGE = 1000;
const CLOSED_LIMIT = 100;
const BOARD_COLUMNS =
  "id, name, phone, governorate, area, source, sales_employee, owner_id, project_id, lead_project_id, follow_up_date, last_contact_at, stage, stage_entered_at, lead_temperature, lead_score, created_at";

export default async function SalesBoardPage({
  searchParams = {},
}: {
  searchParams?: { project?: string };
}) {
  // التسويق لا يتصفّح الأشخاص (092)
  if ((await getUserRole()) === "marketing") redirect("/dashboard/crm/overview");

  const supabase = await createClient();
  const [cfg, projects, admin, opts] = await Promise.all([
    getPipelineConfig(),
    getProjectsLite(),
    isAdmin(),
    getClientFilterOptions(),
  ]);
  const openNames = cfg.stages.filter((s) => !s.closed).map((s) => s.name);
  const closedNames = cfg.stages.filter((s) => s.closed).map((s) => s.name);

  // اللوحة بمشروعٍ واحد (217) — مشروع الليد نفسه الذي ترشّح به القائمة.
  // مشروعٌ ليس في نطاق السائل يُتجاهل كأنه لم يُطلب
  const project = opts.projects.some((p) => p.id === searchParams.project)
    ? (searchParams.project as string)
    : null;
  // (النوع عامٌّ عمداً: قيدٌ على باني Supabase يُغرق فاحص الأنواع)
  const inProject = <Q,>(q: Q): Q =>
    project ? (q as unknown as { eq: (col: string, v: string) => Q }).eq("lead_project_id", project) : q;

  let error: string | null = null;

  // المفتوحة كاملةً — صفحةً صفحة حتى النهاية
  const open: Client[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: e } = await inProject(
      supabase.from("clients").select(BOARD_COLUMNS).in("stage", openNames)
    )
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (e) { error = e.message; break; }
    open.push(...((data ?? []) as Client[]));
    if (!data || data.length < PAGE) break;
  }

  // المغلقة: الأحدث دخولاً إلى مرحلتها + العدد الحقيقي
  const closedCols = await Promise.all(
    closedNames.map(async (name) => {
      const { data, count, error: e } = await inProject(
        supabase.from("clients").select(BOARD_COLUMNS, { count: "exact" }).eq("stage", name)
      )
        .order("stage_entered_at", { ascending: false, nullsFirst: false })
        .limit(CLOSED_LIMIT);
      if (e && !error) error = e.message;
      return { name, rows: (data ?? []) as Client[], total: count ?? 0 };
    })
  );

  // عملاء في مرحلة أُوقفت (ليست عموداً) — يُعلَن عددهم بدل أن يغيبوا صامتين
  const allNames = cfg.stages.map((s) => s.name);
  const { count: elsewhere } = await inProject(
    supabase.from("clients").select("id", { count: "exact", head: true })
  ).not("stage", "in", `(${allNames.map((n) => `"${n}"`).join(",")})`);

  // مهامّ متأخرة على العملاء المعروضين — RLS تحصرها في ما يراه السائل
  const today = baghdadDate();
  const overdueTasks: Record<string, number> = {};
  for (let from = 0; from < 10000; from += PAGE) {
    const { data } = await supabase
      .from("tasks")
      .select("client_id")
      .in("status", ["جديدة", "قيد التنفيذ"])
      .lt("due_date", today)
      .not("client_id", "is", null)
      .range(from, from + PAGE - 1);
    for (const t of (data ?? []) as { client_id: string }[]) {
      overdueTasks[t.client_id] = (overdueTasks[t.client_id] ?? 0) + 1;
    }
    if (!data || data.length < PAGE) break;
  }

  const columns: Record<string, BoardColumnMeta> = {};
  for (const n of openNames) {
    const total = open.filter((c) => (c.stage ?? "ليد") === n).length;
    columns[n] = { total, truncated: false };
  }
  for (const c of closedCols) columns[c.name] = { total: c.total, truncated: c.total > c.rows.length };

  const clients = [...open, ...closedCols.flatMap((c) => c.rows)];
  const projectNames = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">مسار العملاء</h1>
        </div>
        {/* تبديل العرض: قائمة / لوحة */}
        <div className="flex rounded-lg border p-0.5 text-sm">
          <Link href="/dashboard/clients" className="rounded-md px-3 py-1.5 text-gray-500 hover:bg-gray-100">
            قائمة
          </Link>
          <span className="rounded-md bg-brand-600 px-3 py-1.5 font-semibold text-white">
            لوحة المسار
          </span>
        </div>
      </header>

      <CrmTabs active="clients" />

      {opts.projects.length > 1 && (
        <div className="mx-6 mt-4">
          <ProjectTabs
            base="/dashboard/clients/board"
            params={project ? { project } : {}}
            projects={opts.projects}
            active={project}
          />
        </div>
      )}

      {error ? (
        <div className="m-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          تعذّر جلب العملاء: {error}
        </div>
      ) : (
        <>
        {(elsewhere ?? 0) > 0 && (
          <p className="mx-6 mt-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
            {elsewhere} عميلاً في مراحل موقوفة لا تظهر أعمدةً هنا — تجدهم في{" "}
            <Link href="/dashboard/clients" className="font-semibold underline">القائمة</Link>.
          </p>
        )}
        <SalesBoard
          initial={clients}
          stages={cfg.stages}
          silence={cfg.silence}
          columns={columns}
          overdueTasks={overdueTasks}
          projectNames={projectNames}
          isAdmin={admin}
          closedLimit={CLOSED_LIMIT}
          project={project}
        />
        </>
      )}
    </main>
  );
}
