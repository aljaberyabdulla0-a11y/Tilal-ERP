import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import CrmTabs from "../../crm/crm-tabs";
import ImportClients from "./import-clients";

// استيراد العملاء من ملف اكسل — للمدير فقط
export default async function ImportClientsPage() {
  if (!(await isAdmin())) redirect("/dashboard/clients");

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/clients" className="text-sm text-gray-500 hover:text-brand-700">
          ← العملاء
        </Link>
        <h1 className="text-xl font-bold text-brand-700">استيراد عملاء من اكسل</h1>
      </header>

      <CrmTabs active="clients" />

      <section className="p-6">
        <ImportClients />
      </section>
    </main>
  );
}
