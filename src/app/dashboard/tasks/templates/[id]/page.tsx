import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAssignablePeople, getTaskLookups } from "@/lib/tasks-server";
import TemplateEditor from "@/components/tasks/template-editor";
import type { TaskTemplate, TaskTemplateItem } from "@/lib/types";

// محرّر القالب — /templates/new للجديد. الحفظ تحكمه RLS (190).
export default async function TemplateEditPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const isNew = params.id === "new";
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(params.id)) notFound();

  const [lookups, people, { data: roles }] = await Promise.all([
    getTaskLookups(), getAssignablePeople(),
    supabase.from("roles").select("code, name_ar").eq("status", "نشط").order("sort_order"),
  ]);

  let template: TaskTemplate | null = null;
  if (!isNew) {
    const [{ data }, { data: items }] = await Promise.all([
      supabase.from("task_templates").select("*").eq("id", params.id).maybeSingle(),
      supabase.from("task_template_items").select("*").eq("template_id", params.id).order("position"),
    ]);
    if (!data) notFound();
    template = { ...(data as TaskTemplate), items: (items ?? []) as TaskTemplateItem[] };
  }

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <nav className="mb-2 text-sm text-gray-500" aria-label="مسار التنقّل">
        <Link href="/dashboard/tasks" className="hover:text-brand-700">المهام</Link> ‹{" "}
        <Link href="/dashboard/tasks/templates" className="hover:text-brand-700">القوالب</Link>
      </nav>
      <h1 className="mb-5 text-2xl font-bold text-ink">{isNew ? "قالب جديد" : `تعديل: ${template?.name_ar}`}</h1>
      <div className="max-w-5xl">
        <TemplateEditor template={template} people={people} departments={lookups.departments} types={lookups.types}
          workflows={lookups.workflows} workspaces={lookups.workspaces}
          roles={(roles ?? []) as { code: string; name_ar: string }[]} />
      </div>
    </main>
  );
}
