import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getProjects, getTeamMembers } from "@/lib/projects";
import { BrokerCompany, BrokerCompanyProject } from "@/lib/types";
import CompanyForm from "../../company-form";

// تعديل شركة وسيطة (للمدير)
export default async function EditBrokerCompanyPage({
  params,
}: {
  params: { id: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard/brokers");

  const supabase = await createClient();
  const [{ data }, { data: links }, projects, employees] = await Promise.all([
    supabase.from("broker_companies").select("*").eq("id", params.id).maybeSingle(),
    supabase.from("broker_company_projects").select("*").eq("company_id", params.id),
    getProjects(),
    getTeamMembers(),
  ]);

  if (!data) notFound();
  const company = data as BrokerCompany;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href={`/dashboard/brokers/${company.id}`}
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← {company.name}
        </Link>
        <h1 className="text-xl font-bold text-brand-700">تعديل الشركة</h1>
      </header>

      <section className="p-6">
        <CompanyForm
          initial={company}
          companyId={company.id}
          projects={projects}
          employees={employees.filter((e) => e.status === "active")}
          assignments={(links ?? []) as BrokerCompanyProject[]}
        />
      </section>
    </main>
  );
}
