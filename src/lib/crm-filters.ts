import { getProjectsLite, getSources, getEmployeesLite, type CrmFilters } from "@/lib/crm";

// ============================================================
// المُرشِّحات الموحّدة (§44).
//
// ===== لماذا ملفّ واحد =====
//
// كانت كل لوحة تقرأ مُرشِّحاتها بطريقتها: التقارير `?days=30`،
// والقائمة `?filter=&temperature=`، والتنبؤ `?period=&by=`. فالانتقال
// من لوحة إلى أخرى يُسقط ما اختاره القارئ، ويعود يختاره من جديد —
// وأخطر منه أنه قد **لا ينتبه** أنه سقط، فيقارن رقم مشروع بعينه
// برقم الشركة كلها.
//
// هنا مفردات واحدة تقرأها كل لوحة بنفس الأسماء، فينتقل المُرشِّح
// معها في الرابط.
//
//     from, to        المدى الزمني (أو days اختصاراً)
//     owner           الموظف
//     project         المشروع
//     source          المصدر
//     team            الفريق (= المشروع منذ sql/037)
//
// ⚠️ لا تُترجَم إلى أسماء أخرى في أي صفحة. الاسم نفسه في الرابط
//    وفي `CrmFilters` وفي معاملات دوال 076 — ثلاث طبقات بمفردات
//    واحدة، فلا يضيع مُرشِّح في الترجمة بينها.
// ============================================================

export type CrmSearchParams = {
  days?: string;
  from?: string;
  to?: string;
  owner?: string;
  project?: string;
  source?: string;
  team?: string;
};

export type ParsedCrmFilters = {
  /** ما يُمرَّر إلى دوال 076 */
  filters: CrmFilters;
  /** ما يُعاد بناء الرابط منه — بلا القيم الافتراضية */
  params: Record<string, string>;
  /** عدد الأيام المختار، أو null حين يُحدَّد مدى صريح */
  days: number | null;
  /** وصفٌ عربي لما هو مُفعَّل — يُعرض فوق اللوحة */
  labels: string[];
};

const DEFAULT_DAYS = 30;
export const DAY_CHOICES = [7, 30, 90, 365];

function isDate(v: string | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// ⚠️ تُستدعى من مكوّن خادم: تقرأ القوائم لتحويل المعرّفات إلى أسماء.
//    والقوائم مخزَّنة بـcache() لنطاق الطلب، فلا رحلة إضافية.
export async function parseCrmFilters(sp: CrmSearchParams): Promise<ParsedCrmFilters> {
  const [projects, sources, employees] = await Promise.all([
    getProjectsLite(),
    getSources(),
    getEmployeesLite(),
  ]);

  // مدى صريح يغلب عدد الأيام: من كتب تاريخين قصدهما
  const explicit = isDate(sp.from) || isDate(sp.to);
  const days = explicit ? null : Number(sp.days) || DEFAULT_DAYS;

  const to = isDate(sp.to) ? sp.to : todayISO();
  const from = isDate(sp.from)
    ? sp.from
    : new Date(Date.now() - (days ?? DEFAULT_DAYS) * 86400000).toISOString().slice(0, 10);

  // المعرّف يُقبل فقط إن كان في القائمة — وإلا فهو من رابط قديم أو
  // مُلفَّق، ويُتجاهل بصمت أفضل من إظهار «لا نتائج» بلا سبب.
  const owner = employees.find((e) => e.id === sp.owner)?.id ?? null;
  const project = projects.find((p) => p.id === sp.project)?.id ?? null;
  const team = projects.find((p) => p.id === sp.team)?.id ?? null;
  const source = sources.find((s) => s.id === sp.source)?.id ?? null;

  const params: Record<string, string> = {};
  if (explicit) {
    if (isDate(sp.from)) params.from = sp.from;
    if (isDate(sp.to)) params.to = sp.to;
  } else if (days !== DEFAULT_DAYS) {
    params.days = String(days);
  }
  if (owner) params.owner = owner;
  if (project) params.project = project;
  if (team) params.team = team;
  if (source) params.source = source;

  const labels: string[] = [];
  if (explicit) labels.push(`من ${from} إلى ${to}`);
  else if (days !== DEFAULT_DAYS) labels.push(days === 365 ? "آخر سنة" : `آخر ${days} يوماً`);
  if (owner) labels.push(`الموظف: ${employees.find((e) => e.id === owner)?.full_name ?? ""}`);
  if (project) labels.push(`المشروع: ${projects.find((p) => p.id === project)?.name ?? ""}`);
  if (team) labels.push(`الفريق: ${projects.find((p) => p.id === team)?.name ?? ""}`);
  if (source) labels.push(`المصدر: ${sources.find((s) => s.id === source)?.name ?? ""}`);

  return {
    filters: { from, to, ownerId: owner, projectId: project, teamId: team, sourceId: source },
    params,
    days,
    labels,
  };
}

function todayISO(): string {
  // بتوقيت بغداد: اليوم ينتهي هناك لا في UTC
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date());
}
