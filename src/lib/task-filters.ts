// ============================================================
// مرشّحات المهام — دوال خالصة (بلا قاعدة) تُستعمل في الخادم والمتصفح.
//
// المرشّح يعيش في عنوان الصفحة: ?q=…&status=جديدة,قيد التنفيذ&dept=…
// فالحفظ (العروض المحفوظة) هو حفظ العنوان، والرابط يُرسل لزميل كما هو.
// toTaskListPayload يحوّله إلى ما تقبله task_list (191).
// ============================================================

export const TASK_VIEWS = ["mine", "team", "departments", "list", "board", "calendar"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const TASK_SORTS = ["smart", "due", "due_desc", "priority", "created", "updated", "title"] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

export const TASK_BUCKETS = [
  "late", "today", "upcoming", "nodate", "open", "waiting", "due_soon", "done", "completed",
  "pending_approval", "sla",
] as const;
export type TaskBucket = (typeof TASK_BUCKETS)[number];

export const TASK_SCOPES = ["mine", "created", "approvals", "team", "department", "watching"] as const;
export type TaskScopeFilter = (typeof TASK_SCOPES)[number];

export type TaskFilters = {
  q?: string;
  scope?: TaskScopeFilter;
  bucket?: TaskBucket;
  status?: string[];
  priority?: string[];
  type?: string[];
  source?: string[];
  dept?: string;
  workspace?: string;
  assignee?: string;   // uuid | "me"
  creator?: string;    // uuid | "me"
  project?: string;
  campaign?: string;
  client?: string;
  opportunity?: string;
  label?: string;
  from?: string;       // YYYY-MM-DD
  to?: string;
  archived?: "include" | "only";
  orphan?: boolean;    // عميل مغلق ومهمته مفتوحة (رابط الجودة 077)
  sort?: TaskSort;
  top?: boolean;       // المهام الرئيسية فقط
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const one = (v: string | string[] | undefined): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
};
const list = (v: string | string[] | undefined): string[] | undefined => {
  const s = one(v);
  if (!s) return undefined;
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length ? Array.from(new Set(parts)) : undefined;
};
const idOrMe = (v: string | undefined) => (v === "me" || (v && UUID.test(v)) ? v : undefined);
const id = (v: string | undefined) => (v && UUID.test(v) ? v : undefined);
const day = (v: string | undefined) => (v && DAY.test(v) ? v : undefined);
function pick<T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function parseTaskFilters(sp: Record<string, string | string[] | undefined>): TaskFilters {
  const f: TaskFilters = {
    q: one(sp.q)?.slice(0, 120),
    scope: pick(one(sp.scope), TASK_SCOPES),
    bucket: pick(one(sp.bucket), TASK_BUCKETS),
    status: list(sp.status)?.filter((s) => ["جديدة", "قيد التنفيذ", "منجزة", "ملغاة"].includes(s)),
    priority: list(sp.priority)?.filter((s) => ["عاجلة", "متوسطة", "عادية"].includes(s)),
    type: list(sp.type)?.filter((s) => /^[a-z][a-z0-9_]*$/.test(s)),
    source: list(sp.source)?.filter((s) => /^[a-z][a-z_]*$/.test(s)),
    dept: id(one(sp.dept)),
    workspace: one(sp.workspace)?.match(/^[a-z][a-z_]*$/)?.[0],
    assignee: idOrMe(one(sp.assignee)),
    creator: idOrMe(one(sp.creator)),
    project: id(one(sp.project)),
    campaign: id(one(sp.campaign)),
    client: id(one(sp.client)),
    opportunity: id(one(sp.opportunity)),
    label: id(one(sp.label)),
    from: day(one(sp.from)),
    to: day(one(sp.to)),
    archived: pick(one(sp.archived), ["include", "only"] as const),
    orphan: one(sp.orphan) === "1" || one(sp.filter) === "orphan" ? true : undefined,
    sort: pick(one(sp.sort), TASK_SORTS),
    top: one(sp.top) === "1" ? true : undefined,
  };
  // لا مفاتيح فارغة: الكائن المحفوظ والمقارَن يبقى نظيفاً
  (Object.keys(f) as (keyof TaskFilters)[]).forEach((k) => {
    const v = f[k];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) delete f[k];
  });
  return f;
}

// إلى معاملات العنوان (للروابط والعروض المحفوظة)
export function taskFiltersToParams(f: TaskFilters): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (k: string, v: string | undefined) => {
    if (v) out[k] = v;
  };
  set("q", f.q);
  set("scope", f.scope);
  set("bucket", f.bucket);
  set("status", f.status?.join(","));
  set("priority", f.priority?.join(","));
  set("type", f.type?.join(","));
  set("source", f.source?.join(","));
  set("dept", f.dept);
  set("workspace", f.workspace);
  set("assignee", f.assignee);
  set("creator", f.creator);
  set("project", f.project);
  set("campaign", f.campaign);
  set("client", f.client);
  set("opportunity", f.opportunity);
  set("label", f.label);
  set("from", f.from);
  set("to", f.to);
  set("archived", f.archived);
  if (f.orphan) out.orphan = "1";
  set("sort", f.sort);
  if (f.top) out.top = "1";
  return out;
}

export function countActiveFilters(f: TaskFilters): number {
  return Object.keys(taskFiltersToParams(f)).filter((k) => k !== "sort").length;
}

// إلى ما تقبله task_list(p jsonb)
export function toTaskListPayload(f: TaskFilters, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (f.q) p.q = f.q;
  if (f.scope) p.scope = f.scope;
  if (f.bucket) p.bucket = f.bucket;
  if (f.status?.length) p.status = f.status;
  if (f.priority?.length) p.priority = f.priority;
  if (f.type?.length) p.task_type = f.type;
  if (f.source?.length) p.task_source = f.source;
  if (f.dept) p.department_id = f.dept;
  if (f.workspace) p.workspace = f.workspace;
  if (f.assignee) p.assigned_to = f.assignee;
  if (f.creator) p.created_by = f.creator;
  if (f.project) p.project_id = f.project;
  if (f.campaign) p.campaign_id = f.campaign;
  if (f.client) p.client_id = f.client;
  if (f.opportunity) p.opportunity_id = f.opportunity;
  if (f.label) p.label_id = f.label;
  if (f.from) p.due_from = f.from;
  if (f.to) p.due_to = f.to;
  if (f.archived) p.archived = f.archived;
  if (f.orphan) p.orphan = true;
  if (f.sort) p.sort = f.sort;
  if (f.top) p.parent = "top";
  return { ...p, ...extra };
}

export function parseView(v: string | string[] | undefined, fallback: TaskView = "mine"): TaskView {
  return pick(one(v), TASK_VIEWS) ?? fallback;
}

export function parsePage(v: string | string[] | undefined): number {
  const n = Number(one(v));
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 1;
}

// رابط بمعاملات مع تجاوزات (null يحذف المفتاح)
export function withParams(
  basePath: string,
  params: Record<string, string>,
  over: Record<string, string | null> = {},
): string {
  const q = new URLSearchParams(params);
  for (const [k, v] of Object.entries(over)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}
