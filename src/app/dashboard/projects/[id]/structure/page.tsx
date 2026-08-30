import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { canEditUnit } from "@/lib/projects";
import { getProject, getProjectNodes, getProjectUnits } from "@/lib/estate";
import { buildNodeTree } from "@/lib/types";
import StructureManager from "./structure-manager";

// هيكل المشروع — تحديد مستوياته وبناء شجرته
export default async function StructurePage({
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

  const [nodes, units] = await Promise.all([
    getProjectNodes(params.id),
    getProjectUnits(params.id),
  ]);

  // عدد وحدات كل عقدة مباشرةً — لتحذير الحذف
  const directUnits: Record<string, number> = {};
  for (const u of units) {
    if (u.node_id) directUnits[u.node_id] = (directUnits[u.node_id] ?? 0) + 1;
  }

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
          <h1 className="text-xl font-bold text-brand-700">هيكل المشروع</h1>
          <p className="text-sm text-gray-500">
            كيف يُقسَّم هذا المشروع، ومن أين تبدأ الوحدات.
          </p>
        </div>
      </header>

      <section className="p-6">
        <StructureManager
          projectId={project.id}
          structureKinds={project.structure_kinds ?? []}
          tree={buildNodeTree(nodes)}
          directUnits={directUnits}
        />
      </section>
    </main>
  );
}
