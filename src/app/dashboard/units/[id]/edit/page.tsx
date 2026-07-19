import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Unit } from "@/lib/types";
import UnitForm from "../../unit-form";

// صفحة تعديل وحدة عقارية — للمدير فقط
export default async function EditUnitPage({
  params,
}: {
  params: { id: string };
}) {
  // حماية من جهة الخادم
  if (!(await isAdmin())) {
    redirect(`/dashboard/units/${params.id}`);
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("units")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!data) notFound();
  const unit = data as Unit;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href={`/dashboard/units/${unit.id}`}
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← تفاصيل الوحدة
        </Link>
        <h1 className="text-xl font-bold text-brand-700">تعديل الوحدة</h1>
      </header>

      <section className="p-6">
        <UnitForm initial={unit} unitId={unit.id} />
      </section>
    </main>
  );
}
