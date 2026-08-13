import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Unit } from "@/lib/types";
import { canEditUnit, getProjects } from "@/lib/projects";
import UnitForm from "../../unit-form";

// صفحة تعديل وحدة عقارية — للمدير، وللمشرف على مشروع هذه الوحدة
export default async function EditUnitPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("units")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!data) notFound();
  const unit = data as Unit;

  // الحماية بعد الجلب لأن الصلاحية تعتمد مشروع الوحدة نفسها.
  // وهذه للواجهة فقط — سياسة «update units in scope» في القاعدة
  // هي التي تمنع الحفظ فعلياً.
  if (!(await canEditUnit(unit.project_id, await isAdmin()))) {
    redirect(`/dashboard/units/${params.id}`);
  }

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
        <UnitForm initial={unit} unitId={unit.id} projects={await getProjects()} />
      </section>
    </main>
  );
}
