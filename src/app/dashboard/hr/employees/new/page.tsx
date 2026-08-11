import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { CompanySettings } from "@/lib/types";
import { getProjects } from "@/lib/projects";
import EmployeeForm from "../employee-form";

// حسابات غير مرتبطة بموظف بعد (لخيار الربط)
async function getAvailableAccounts() {
  const supabase = await createClient();
  const [{ data: profiles }, { data: employees }] = await Promise.all([
    supabase.from("profiles").select("id, email"),
    supabase.from("employees").select("user_id"),
  ]);
  const linked = new Set(
    (employees ?? []).map((e: { user_id: string | null }) => e.user_id).filter(Boolean)
  );
  return (profiles ?? []).filter((p: { id: string }) => !linked.has(p.id));
}

export default async function NewEmployeePage() {
  if (!(await isAdmin())) redirect("/dashboard");
  const supabase = await createClient();
  const [accounts, { data: cfg }] = await Promise.all([
    getAvailableAccounts(),
    supabase.from("company_settings").select("*").eq("id", 1).maybeSingle(),
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/hr/employees"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← الموظفون
        </Link>
        <h1 className="text-xl font-bold text-brand-700">موظف جديد</h1>
      </header>

      <section className="p-6">
        <EmployeeForm
          accounts={accounts}
          settings={(cfg as CompanySettings) ?? null}
          projects={await getProjects()}
        />
      </section>
    </main>
  );
}
