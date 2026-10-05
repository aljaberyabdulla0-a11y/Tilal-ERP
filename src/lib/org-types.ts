// أنواع الهيكل التنظيمي والأدوار وثوابتها (sql/145–146) — بلا استيراد خادم،
// فتُستورد من مكوّنات العميل والخادم معاً.

export type Branch = { id: string; code: string; name_ar: string; status: string };

export type DepartmentNode = {
  id: string;
  parent_id: string | null;
  code: string;
  name_ar: string;
  name_en: string | null;
  unit_type: string;
  status: string;
  sort_order: number;
  depth: number;
  path: string;
  manager_id: string | null;
  manager_name: string | null;
  branch_name: string | null;
  direct_headcount: number;
  total_headcount: number;
  positions_count: number;
};

export type Department = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  unit_type: string;
  parent_id: string | null;
  manager_id: string | null;
  branch_id: string | null;
  status: string;
  sort_order: number;
};

export type Position = {
  id: string;
  code: string;
  title_ar: string;
  title_en: string | null;
  department_id: string;
  job_grade_id: string | null;
  reports_to_position_id: string | null;
  employment_type: string;
  default_role_code: string | null;
  headcount_budget: number | null;
  job_description: string | null;
  responsibilities: string | null;
  status: string;
  sort_order: number;
};

export type JobGrade = {
  id: string;
  code: string;
  name_ar: string;
  level: number;
  salary_min: number | null;
  salary_max: number | null;
  notes: string | null;
  status: string;
};

export type EmploymentType = { code: string; name_ar: string; active: boolean };

export type Role = {
  code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  base_role: string;
  is_system: boolean;
  status: string;
  sort_order: number;
};

export type AppModule = {
  code: string;
  name_ar: string;
  area: string;
  enforced: boolean;
  sort_order: number;
  note: string | null;
};

export type RolePermission = {
  role_code: string;
  module: string;
  actions: string[];
  scope: string;
};

export type DepartmentMember = {
  id: string;
  employee_code: string;
  full_name: string;
  status: string;
  hire_date: string | null;
  department_id: string | null;
  department_name: string | null;
  position_id: string | null;
  position_title: string | null;
  manager_id: string | null;
  manager_name: string | null;
  project_name: string | null;
  has_account: boolean;
};

export const UNIT_TYPES = ["إدارة", "قسم فرعي", "فريق"] as const;

// ترتيب الأعمدة في مصفوفة الصلاحيات — يطابق role_permissions_actions_known
export const PERMISSION_ACTIONS: { key: string; label: string }[] = [
  { key: "read", label: "قراءة" },
  { key: "create", label: "إنشاء" },
  { key: "update", label: "تعديل" },
  { key: "delete", label: "حذف" },
  { key: "approve", label: "اعتماد" },
  { key: "export", label: "تصدير" },
  { key: "manage", label: "إدارة" },
  { key: "view_financial", label: "مالي" },
  { key: "view_salary", label: "رواتب" },
  { key: "view_personal", label: "شخصي" },
];

export const PERMISSION_SCOPES: { key: string; label: string }[] = [
  { key: "own", label: "نفسه" },
  { key: "team", label: "فريقه" },
  { key: "department", label: "قسمه" },
  { key: "all", label: "الكل" },
];

// المستويات الأمنية العشرة — ما تقرؤه سياسات RLS القائمة (profiles.role)
export const BASE_ROLES = [
  "admin",
  "hr",
  "accountant",
  "supervisor",
  "followup_manager",
  "relationship_manager",
  "marketing",
  "viewer",
  "employee",
] as const;
// «broker» ليس هنا عمداً: حساب الوسيط يُربط بشركته من صفحة الشركة

// اسم القسم مسبوقاً بآبائه: «المبيعات › مندوبو المبيعات»
export function departmentLabel(d: { id: string }, all: Department[]): string {
  const byId = new Map(all.map((x) => [x.id, x]));
  const parts: string[] = [];
  let cur = byId.get(d.id);
  let guard = 0;
  while (cur && guard++ < 10) {
    parts.unshift(cur.name_ar);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return parts.join(" › ");
}
