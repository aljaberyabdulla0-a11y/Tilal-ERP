import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getProject } from "@/lib/estate";
import PricesUploader from "./prices-uploader";

// تحديث أسعار وحدات المشروع من ملف اكسل — للمدير وحده
export default async function ProjectPricesPage({ params }: { params: { id: string } }) {
  const project = await getProject(params.id);
  if (!project) notFound();
  if (!(await isAdmin())) redirect(`/dashboard/projects/${project.id}`);

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
          <h1 className="text-xl font-bold text-brand-700">تحديث الأسعار من اكسل</h1>
          <p className="text-sm text-gray-500">
            ارفع جدول التسعير كما هو — سعرٌ لكل وحدة، ولا يُحفظ شيء قبل المعاينة.
          </p>
        </div>
      </header>

      <section className="p-6">
        <PricesUploader projectId={project.id} />
      </section>
    </main>
  );
}
