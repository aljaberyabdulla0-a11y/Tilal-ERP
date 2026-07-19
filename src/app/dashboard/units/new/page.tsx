import Link from "next/link";
import UnitForm from "../unit-form";

// صفحة إضافة وحدة عقارية — تستخدم النموذج المشترك
export default function NewUnitPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/units"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← الوحدات العقارية
        </Link>
        <h1 className="text-xl font-bold text-brand-700">وحدة جديدة</h1>
      </header>

      <section className="p-6">
        <UnitForm />
      </section>
    </main>
  );
}
