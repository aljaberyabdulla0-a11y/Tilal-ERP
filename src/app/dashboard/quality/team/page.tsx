import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import TeamManager, { type MemberRow, type TeamRow, type TypeRow } from "./team-manager";

// إدارة فريق ضبط الجودة (sql/230) — المدير العام وحده: القائد والأعضاء من أي قسم، الأدوار والتخصصات
// والسعة، الإيقاف والإنهاء، التفعيل، وسياسة الاتصال وSLA (Q11/Q12). العضو يبقى تابعاً إدارياً لقسمه.
export default async function QualityTeamPage() {
  if (!(await isAdmin())) redirect("/dashboard/quality");
  const supabase = await createClient();
  const [{ data: teams }, { data: members }, { data: emps }, { data: types }, { data: teamTypes }] = await Promise.all([
    supabase.from("review_teams").select("*").is("archived_at", null).order("created_at"),
    supabase.from("review_team_members").select("*").order("start_date", { ascending: false }),
    supabase.from("employees").select("id, full_name, department, user_id").eq("status", "active").order("full_name"),
    supabase.from("review_types").select("code, name_ar, is_active, contact_policy, sla_policy").order("sort_order"),
    supabase.from("review_team_types").select("team_id, review_type"),
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/quality" className="text-sm text-gray-500 hover:text-brand-700">← ضبط الجودة</Link>
        <h1 className="text-xl font-bold text-brand-700">إدارة فريق ضبط الجودة</h1>
      </header>
      <section className="p-6">
        <TeamManager
          teams={(teams ?? []) as TeamRow[]}
          members={(members ?? []) as MemberRow[]}
          employees={((emps ?? []) as { id: string; full_name: string; department: string | null; user_id: string | null }[])
            .filter((e) => e.user_id)
            .map((e) => ({ id: e.id, label: e.full_name + (e.department ? ` — ${e.department}` : "") }))}
          types={(types ?? []) as TypeRow[]}
          teamTypes={(teamTypes ?? []) as { team_id: string; review_type: string }[]}
        />
      </section>
    </main>
  );
}
