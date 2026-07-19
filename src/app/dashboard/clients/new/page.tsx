import Link from "next/link";
import ClientForm from "../client-form";

// صفحة إضافة عميل جديد — تستخدم النموذج المشترك
export default function NewClientPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/clients"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← العملاء
        </Link>
        <h1 className="text-xl font-bold text-brand-700">عميل جديد</h1>
      </header>

      <section className="p-6">
        <ClientForm />
      </section>
    </main>
  );
}
