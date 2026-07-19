import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Client } from "@/lib/types";
import CrmTabs from "../../crm/crm-tabs";
import SalesBoard from "./sales-board";

// لوحة المبيعات (Kanban) — منظور المراحل للعملاء
export default async function SalesBoardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });

  const clients = (data ?? []) as Client[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">CRM</h1>
        </div>
        {/* تبديل العرض: قائمة / لوحة */}
        <div className="flex rounded-lg border p-0.5 text-sm">
          <Link href="/dashboard/clients" className="rounded-md px-3 py-1.5 text-gray-500 hover:bg-gray-100">
            قائمة
          </Link>
          <span className="rounded-md bg-brand-600 px-3 py-1.5 font-semibold text-white">
            لوحة المبيعات
          </span>
        </div>
      </header>

      <CrmTabs active="clients" />

      {error ? (
        <div className="m-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          تعذّر جلب العملاء: {error.message}
          <br />
          تأكّد من تشغيل ملف SQL للوحة المبيعات.
        </div>
      ) : (
        <SalesBoard initial={clients} />
      )}
    </main>
  );
}
