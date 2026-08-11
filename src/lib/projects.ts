import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import type { Project, TeamMember } from "@/lib/types";

// ============================================================
// المشاريع والفريق.
//
// المبدأ الحاكم: **المشرف = موظف، لكن نطاقه مشروعه بدل نفسه.**
//
// ⚠️ لا يوجد في هذا الملف أي فلترة بالدور عمداً. سياسات RLS في
// القاعدة هي التي تُرجع لكل واحد نطاقه: نفس الاستعلام يخدم المدير
// والمشرف والموظف، ولا يمكن نسيان شرطٍ في شاشة فتتسرّب بيانات.
// ============================================================

// كل المشاريع التي يراها المستخدم الحالي (RLS تحدّد أيّها)
export const getProjects = cache(async (): Promise<Project[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .order("name");
  return (data ?? []) as Project[];
});

// أعضاء نطاقي — من المنظور الآمن لا من جدول الموظفين.
// المنظور لا يكشف الرواتب ولا العمولات، وجدول employees نفسه يبقى
// ممنوعاً على المشرف (انظر sql/037).
export const getTeamMembers = cache(async (): Promise<TeamMember[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("*")
    .order("full_name");
  return (data ?? []) as TeamMember[];
});

// المشاريع التي أشرف عليها أنا تحديداً (لعنوان شاشة «فريقي»)
export const getMySupervisedProjects = cache(async (): Promise<Project[]> => {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return [];

  const { data: emp } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!emp?.id) return [];

  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("supervisor_id", emp.id)
    .order("name");

  return (data ?? []) as Project[];
});

// أسماء أعضاء نطاقي — تُطابق clients.sales_employee لفلترة الليدات
export const getTeamMemberNames = cache(async (): Promise<string[]> => {
  const members = await getTeamMembers();
  return members.map((m) => m.full_name).filter(Boolean);
});
