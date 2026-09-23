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
        <Link
          href="/dashboard/clients/import/history"
          className="ms-auto flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:border-brand-600 hover:text-brand-600"
        >
          <span className="material-symbols-outlined text-[18px]">history</span>
          سجلّ الاستيراد
        </Link>
      </header>

      <CrmTabs active="clients" />

      <section className="p-6">
        <ImportClients />
      </section>
    </main>
  );
}
