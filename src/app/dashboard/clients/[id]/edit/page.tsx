import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getSalesEmployeeNames } from "@/lib/hr";
import { Client } from "@/lib/types";
import ClientForm from "../../client-form";

// صفحة تعديل عميل — تجلب بياناته الحالية ثم تعرضها في النموذج المشترك
export default async function EditClientPage({
  params,
}: {
  params: { id: string };
}) {
  // حماية من جهة الخادم: غير المدير يُعاد لصفحة تفاصيل العميل
  if (!(await isAdmin())) {
    redirect(`/dashboard/clients/${params.id}`);
  }

  const supabase = await createClient();
  const [{ data }, employeeNames] = await Promise.all([
    supabase.from("clients").select("*").eq("id", params.id).single(),
    getSalesEmployeeNames(),
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
        />
      </section>
    </main>
  );
}
