// ============================================================
// «لوحة لكل شخص» — أنواع اللوحات وما يُعرض لكلٍّ منها.
//
// القرار نفسه في القاعدة (my_dashboard_views — sql/184): الدور الصريح ←
// الدور المُسنَد ← المنصب في HR، وألسنة من العلاقات، والمدير كل شيء،
// وتخصيص المدير يغلب. هنا فقط: الأنواع، وما يُفعل إن لم تكن 184
// مطبّقة بعد (الرجوع إلى الدور كما كانت اللوحة)، وروابط الألسنة.
//
// خالص بلا خادم: يُختبر في vitest.
// ============================================================

export const VIEWS = [
  "executive", "team", "sales", "marketing", "followup", "rm", "finance", "hr", "viewer", "broker",
] as const;

export type DashView = (typeof VIEWS)[number];

export type ViewsInfo = {
  views: DashView[];
  primary: DashView;
  source: "auto" | "override" | "fallback";
  mismatch: boolean;
  positionTitle: string | null;
  positionRoleName: string | null;
};

const SET = new Set<string>(VIEWS);

export function isView(v: unknown): v is DashView {
  return typeof v === "string" && SET.has(v);
}

// اللوحتان اللتان لهما بوابتهما الخاصة — اللسان رابطٌ إليها لا لوحةٌ هنا
export const PORTAL_VIEWS: Partial<Record<DashView, string>> = {
  finance: "/dashboard/finance",
  hr: "/dashboard/hr",
};

// قبل 184: اللوحة من الدور وحده — كما كانت
export function fallbackViews(role: string): DashView[] {
  switch (role) {
    case "admin": return ["executive"];
    case "supervisor": return ["team"];
    case "marketing": return ["marketing"];
    case "viewer": return ["viewer"];
    case "followup_manager": return ["followup"];
    case "relationship_manager": return ["rm"];
    case "broker": return ["broker"];
    case "accountant": return ["finance"];
    case "hr": return ["hr"];
    default: return ["sales"];
  }
}

// كائن my_dashboard_views ← ViewsInfo نظيف (ما ليس لوحة يُهمل)
export function toViewsInfo(raw: unknown, role: string): ViewsInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  const views = (Array.isArray(r.views) ? r.views : []).filter(isView);
  if (views.length === 0) {
    const fb = fallbackViews(role);
    return { views: fb, primary: fb[0], source: "fallback", mismatch: false, positionTitle: null, positionRoleName: null };
  }
  const primary = isView(r.primary) && views.includes(r.primary) ? r.primary : views[0];
  return {
    views,
    primary,
    source: r.source === "override" ? "override" : "auto",
    mismatch: r.mismatch === true,
    positionTitle: typeof r.position_title === "string" ? r.position_title : null,
    positionRoleName: typeof r.position_role_name === "string" ? r.position_role_name : null,
  };
}

// أيّ لوحة تُعرض الآن: المطلوبة في الرابط إن كانت له، وإلا أولى لوحاته
// المعروضة هنا (لا البوابات). null = ليس له إلا بوابة (المالية/HR).
export function pickView(info: ViewsInfo, requested: string | undefined): DashView | null {
  const inline = info.views.filter((v) => !PORTAL_VIEWS[v]);
  if (requested && isView(requested) && inline.includes(requested)) return requested;
  return inline[0] ?? null;
}

// رابط اللسان — يُبقي الفترة والمشروع عند التنقّل بين اللوحات
export function viewHref(view: DashView, keep: Record<string, string | undefined> = {}): string {
  const portal = PORTAL_VIEWS[view];
  if (portal) return portal;
  const q = new URLSearchParams();
  q.set("view", view);
  for (const k of ["range", "from", "to", "project"]) {
    const v = keep[k];
    if (v) q.set(k, v);
  }
  return `/dashboard?${q.toString()}`;
}
