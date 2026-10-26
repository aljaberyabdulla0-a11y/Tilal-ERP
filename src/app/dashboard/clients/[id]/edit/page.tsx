import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canEditClientCard, isSupervisor } from "@/lib/auth";
import { getSalesEmployeeNames } from "@/lib/hr";
import { Client } from "@/lib/types";
import ClientForm from "../../client-form";
import { getPipelineConfig } from "@/lib/crm-config";
import { getRunningCampaigns } from "@/lib/crm-campaigns";
import { getEmployeesLite, getProjectsLite } from "@/lib/crm";
import { getTeamMembers, memberProjectsByName } from "@/lib/projects";

// صفحة تعديل عميل — تجلب بياناته الحالية ثم تعرضها في النموذج المشترك
export default async function EditClientPage({
  params,
}: {
  params: { id: string };
}) {
  // حماية من جهة الخادم: غير المدير ومدير التسويق (212) ومشرف المبيعات
  // يُعاد لصفحة تفاصيل العميل
  if (!(await canEditClientCard())) {
    redirect(`/dashboard/clients/${params.id}`);
  }

  const supabase = await createClient();
  // المشرف ممنوع من employees (037)، فقائمته من team_members: موظفو فريقه
  // وحدهم — و guard_client_owner لا يسمح له بنقل العميل خارجه أصلاً
  const supervisor = await isSupervisor();
  const [{ data }, employeeNames, cfg, campaigns, projects, members] = await Promise.all([
    // ومشروع الليد الفعلي (217) — قيمة حقل «المشروع» الأولى
    supabase.from("clients").select("*, lead_project_id").eq("id", params.id).single(),
    supervisor
      ? getEmployeesLite().then((rows) =>
          Array.from(new Set(rows.map((e) => e.full_name?.trim()).filter((n): n is string => !!n)))
        )
      : getSalesEmployeeNames(),
    getPipelineConfig(),
    getRunningCampaigns(),
    getProjectsLite(),
    getTeamMembers(),
  ]);

  if (!data) notFound();
  const client = data as Client;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href={`/dashboard/clients/${client.id}`}
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← تفاصيل العميل
        </Link>
        <h1 className="text-xl font-bold text-brand-700">تعديل: {client.name}</h1>
      </header>

      <section className="p-6">
        <ClientForm
          initial={client}
          clientId={client.id}
          employeeNames={employeeNames}
          sources={cfg.sources}
          campaigns={campaigns}
          projects={projects}
          memberProjects={memberProjectsByName(members)}
        />
      </section>
    </main>
  );
}
