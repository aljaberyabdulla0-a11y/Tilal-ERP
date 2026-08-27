import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getProjects, getTeamMembers } from "@/lib/projects";
import CompanyForm from "../company-form";

// إنشاء شركة وسيطة (للمدير)
export default async function NewBrokerCompanyPage() {
  if (!(await isAdmin())) redirect("/dashboard/brokers");

  const [projects, employees] = await Promise.all([
    getProjects(),
    getTeamMembers(),
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/brokers" className="text-sm text-gray-500 hover:text-brand-700">
          ← الشركات الوسيطة
        </Link>
        <h1 className="text-xl font-bold text-brand-700">شركة وسيطة جديدة</h1>
      </header>

      <section className="p-6">
        <CompanyForm
          projects={projects}
          employees={employees.filter((e) => e.status === "active")}
        />
      </section>
    </main>
  );
}
