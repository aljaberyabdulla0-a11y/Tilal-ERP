import { createClient } from "@/lib/supabase/server";
import { baghdadDate } from "@/lib/time";

// ============================================================
// تقارير HR (sql/165) — الشاشة وملف Excel وCSV والطباعة تقرأ
// hr_report نفسها: لا يُحسب في المتصفح رقم، ولا يخرج في الملف رقمٌ لم
// يظهر. النطاق (من يرى من) في القاعدة لا هنا.
// ============================================================

export type HrColumnKind = "text" | "num" | "money" | "pct" | "date";
export type HrColumn = { key: string; label: string; kind: HrColumnKind };
export type HrReportRow = Record<string, string | number | null>;
export type HrReport = {
  key: string;
  title: string;
  from: string;
  to: string;
  columns: HrColumn[];
  rows: HrReportRow[];
};
export type HrCatalogItem = { key: string; title: string; money: boolean; allowed: boolean };

export type HrFilters = {
  report: string;
  from: string;
  to: string;
  department: string;
  employee: string;
  project: string;
  manager: string;
  status: "all" | "active" | "inactive";
};

// المرشّحات من رابط الصفحة — أول الشهر حتى اليوم افتراضاً
export function parseHrFilters(sp: Record<string, string | undefined>): HrFilters {
  const today = baghdadDate();
  const iso = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : "");
  const status = sp.status === "active" || sp.status === "inactive" ? sp.status : "all";
  return {
    report: sp.report && /^[a-z_]{2,30}$/.test(sp.report) ? sp.report : "employees",
    from: iso(sp.from) || `${today.slice(0, 8)}01`,
    to: iso(sp.to) || today,
    department: uuid(sp.department),
    employee: uuid(sp.employee),
    project: uuid(sp.project),
    manager: uuid(sp.manager),
    status,
  };
}

export function filtersQuery(f: HrFilters, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v && v !== "all") q.set(k, v);
  return q.toString();
}

function rpcFilters(f: HrFilters) {
  return {
    department: f.department || undefined,
    employee: f.employee || undefined,
    project: f.project || undefined,
    manager: f.manager || undefined,
    status: f.status,
  };
}

export async function getHrCatalog(): Promise<HrCatalogItem[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("hr_report_catalog");
  return (data ?? []) as HrCatalogItem[];
}

export async function getHrReport(f: HrFilters): Promise<{ report: HrReport | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hr_report", {
    p_report: f.report,
    p_from: f.from,
    p_to: f.to,
    p_filters: rpcFilters(f),
  });
  if (error) return { report: null, error: error.message };
  return { report: data as HrReport, error: null };
}

export type HrDashboard = {
  total: number; active: number; inactive: number; probation: number;
  new_hires: number; exits: number; resignations: number;
  present_today: number; late_today: number; absent_today: number; on_leave_today: number;
  pending_leaves: number; pending_expenses: number; unpaid_expenses: number;
  pending_advances: number; pending_overtime: number;
  docs_expiring: number; probation_ending: number; reviews_open: number;
  open_jobs: number; terminations_open: number;
  payroll_month: { period: string; draft: number; approved: number; locked: number } | null;
  departments: { name: string; count: number }[];
};

export async function getHrDashboard(f?: Partial<HrFilters>): Promise<{ data: HrDashboard | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hr_dashboard", {
    p_filters: f ? rpcFilters({ ...parseHrFilters({}), ...f }) : {},
  });
  if (error) return { data: null, error: error.message };
  return { data: data as HrDashboard, error: null };
}

// عرض خلية — المال والأعداد بفواصل، والنسبة بعلامتها
export function hrCellText(v: unknown, kind: HrColumnKind): string {
  if (v === null || v === undefined || v === "") return "—";
  if (kind === "money" || kind === "num") {
    const n = Number(v);
    return isNaN(n) ? String(v) : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
  if (kind === "pct") {
    const n = Number(v);
    return isNaN(n) ? String(v) : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  }
  return String(v);
}
