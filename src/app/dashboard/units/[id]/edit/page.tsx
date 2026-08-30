import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { canEditUnit, getProjects } from "@/lib/projects";
import { getUnit, getProjectNodes, getUnitTypes } from "@/lib/estate";
import { buildNodeTree } from "@/lib/types";
import UnitForm from "../../unit-form";
import UnitEditor from "../../../projects/[id]/units/unit-editor";

// ============================================================
// تعديل وحدة — للمدير، وللمشرف على مشروع هذه الوحدة.
//
// الوحدة داخل مشروع تُحرَّر بمحرّر المخزون (هيكل + حقول حسب النوع).
// والوحدات القديمة التي لا مشروع لها تبقى على النموذج البسيط، فلا
// يُجبَر أحد على إسنادها لمشروع لمجرّد تصحيح ملاحظة.
// ============================================================
export default async function EditUnitPage({
  params,
}: {
  params: { id: string };
}) {
  const unit = await getUnit(params.id);
  if (!unit) notFound();

  const admin = await isAdmin();
  // الحماية بعد الجلب لأن الصلاحية تعتمد مشروع الوحدة نفسها.
  // وهذه للواجهة فقط — سياسة «update units in scope» في القاعدة
  // هي التي تمنع الحفظ فعلياً.
  if (!(await canEditUnit(unit.project_id, admin))) {
    redirect(`/dashboard/units/${params.id}`);
  }

  const [nodes, unitTypes, projects] = await Promise.all([
    unit.project_id ? getProjectNodes(unit.project_id) : Promise.resolve([]),
    getUnitTypes(),
    unit.project_id ? Promise.resolve([]) : getProjects(),
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href={`/dashboard/units/${unit.id}`}
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← تفاصيل الوحدة
        </Link>
        <h1 className="text-xl font-bold text-brand-700">
          تعديل {unit.unit_code || "الوحدة"}
        </h1>
      </header>

      <section className="p-6">
        {unit.project_id ? (
          <UnitEditor
            projectId={unit.project_id}
            unit={unit}
            nodes={buildNodeTree(nodes)}
            unitTypes={unitTypes}
            isAdmin={admin}
          />
        ) : (
          <UnitForm initial={unit} unitId={unit.id} projects={projects} />
        )}
      </section>
    </main>
  );
}
