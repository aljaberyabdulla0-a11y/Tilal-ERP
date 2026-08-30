import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { canEditUnit } from "@/lib/projects";
import { getProject, getProjectNodes, getUnitTypes } from "@/lib/estate";
import { buildNodeTree } from "@/lib/types";
import UnitEditor from "../unit-editor";

// وحدة جديدة داخل مشروع
export default async function NewUnitPage({
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

  const [nodes, unitTypes] = await Promise.all([
    getProjectNodes(params.id),
    getUnitTypes(),
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href={`/dashboard/projects/${project.id}`}
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← {project.name}
        </Link>
        <h1 className="text-xl font-bold text-brand-700">وحدة جديدة</h1>
      </header>

      <section className="p-6">
        <UnitEditor
          projectId={project.id}
          unit={null}
          nodes={buildNodeTree(nodes)}
          unitTypes={unitTypes}
          isAdmin={admin}
        />
      </section>
    </main>
  );
}
