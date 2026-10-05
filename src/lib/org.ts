import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// ============================================================
// الهيكل التنظيمي والأدوار (sql/145–146).
//
// القراءة هنا، والكتابة من مكوّنات العميل مباشرةً على الجداول —
// والحماية في RLS ومحفّزات القاعدة (حلقات، أرشفة، اشتقاق الدور).
// ============================================================

import type { Branch, Department, DepartmentNode, EmploymentType, Position } from "@/lib/org-types";

export * from "@/lib/org-types";


// الشجرة كاملةً بأعداد الموظفين (دالة القاعدة — بلا أرقام مالية)
export const getDepartmentTree = cache(
  async (includeArchived = false): Promise<DepartmentNode[]> => {
    const supabase = await createClient();
    const { data } = await supabase.rpc("department_tree", {
      p_include_archived: includeArchived,
    });
    return (data ?? []) as DepartmentNode[];
  }
);

// هل يدير المستخدم الحالي الهيكل؟ (المدير/HR أو صلاحية organization.manage)
export const canManageOrg = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("can_manage_org");
  if (error) return false;
  return data === true;
});

// الأقسام التي يديرها المستخدم الحالي (وما تحتها)
export const getMyManagedDepartmentIds = cache(async (): Promise<string[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_managed_department_ids");
  if (error) return [];
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
});

// قوائم الاختيار في نماذج الموظف والمنصب
export async function getOrgLookups() {
  const supabase = await createClient();
  const [deps, poss, brs, types] = await Promise.all([
    supabase.from("departments").select("*").eq("status", "نشط").order("sort_order"),
    supabase.from("positions").select("*").eq("status", "نشط").order("sort_order"),
    supabase.from("branches").select("id, code, name_ar, status").eq("status", "نشط").order("code"),
    supabase.from("employment_types").select("*").eq("active", true).order("sort_order"),
  ]);
  return {
    departments: (deps.data ?? []) as Department[],
    positions: (poss.data ?? []) as Position[],
    branches: (brs.data ?? []) as Branch[],
    employmentTypes: (types.data ?? []) as EmploymentType[],
  };
}


// كل ما يحتاجه نموذج الموظف من الهيكل: القوائم، والمدراء المحتملون،
// وأسماء الأدوار (لعرض «الدور المقترح» للمنصب)
export async function getEmployeeFormOrgData() {
  const supabase = await createClient();
  const [org, { data: people }, { data: roles }] = await Promise.all([
    getOrgLookups(),
    supabase.from("employees").select("id, full_name, employee_code").eq("status", "active").order("full_name"),
    supabase.from("roles").select("code, name_ar"),
  ]);
  const roleNames: Record<string, string> = {};
  ((roles ?? []) as { code: string; name_ar: string }[]).forEach((r) => (roleNames[r.code] = r.name_ar));
  return {
    org,
    people: (people ?? []) as { id: string; full_name: string; employee_code: string }[],
    roleNames,
  };
}
