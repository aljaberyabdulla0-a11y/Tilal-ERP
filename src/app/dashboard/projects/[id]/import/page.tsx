import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { canEditUnit } from "@/lib/projects";
import {
  getProject,
  getProjectNodes,
  getProjectUnits,
  getUnitTypes,
} from "@/lib/estate";
import UnitsImporter from "./units-importer";

// رفع الوحدات جماعياً من ملف CSV
export default async function ImportUnitsPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await getProject(params.id);
  if (!project) notFound();

  const admin = await isAdmin();
  if (!(await canEditUnit(project.id, admin))) {
    redirect(`/dashboard/projects/${project.id}`);
  }

  const [nodes, unitTypes, units] = await Promise.all([
    getProjectNodes(params.id),
    getUnitTypes(),
    getProjectUnits(params.id),
  ]);

  // الوحدات القائمة بمفتاح «الموقع + الرقم»: رقم الشقة يتكرّر بين
  // المباني (01 في B1 و01 في B2)، فالتفرّد داخل الموقع لا في
  // المشروع كله — وإلا رُفض نصف ملفّ مشروع متعدّد الأبراج.
  const existingCodes = units
    .filter((u) => u.unit_code)
    .map((u) => `${u.node_path ?? ""} ${u.unit_code}`);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href={`/dashboard/projects/${project.id}`}
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← {project.name}
        </Link>
        <div>
          <h1 className="text-xl font-bold text-brand-700">رفع الوحدات جماعياً</h1>
          <p className="text-sm text-gray-500">
            ملف CSV واحد بدل إدخال مئات الوحدات يدوياً.
          </p>
        </div>
      </header>

      <section className="p-6">
        <UnitsImporter
          projectId={project.id}
          nodes={nodes}
          structureKinds={project.structure_kinds ?? []}
          unitTypes={unitTypes}
          existingCodes={existingCodes}
          isAdmin={admin}
        />
      </section>
    </main>
  );
}
