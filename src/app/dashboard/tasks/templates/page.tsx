import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { canManageTaskConfig, getTaskLookups } from "@/lib/tasks-server";
import TemplatePicker from "@/components/tasks/template-picker";
import { EmptyState, NotReady } from "@/components/tasks/work-center-ui";
import type { TaskTemplate } from "@/lib/types";

// ============================================================
// القوالب — يُنشأ القالب مرة ويُستعمل مراراً: مهمة رئيسية وفرعيتها
// وتبعياتها وقائمة تحققها وقواعد إسنادها دفعة واحدة.
// ============================================================
export default async function TemplatesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient();
  const ws = typeof searchParams.workspace === "string" ? searchParams.workspace : "";
  const [lookups, canManage, { data: user }] = await Promise.all([
    getTaskLookups(), canManageTaskConfig(null), supabase.auth.getUser(),
  ]);

  let q = supabase.from("task_templates").select("*, task_template_items(count)").order("name_ar");
  if (ws) q = q.eq("workspace", ws);
  const { data } = await q;
  const templates = (data ?? []) as (TaskTemplate & { task_template_items: { count: number }[] })[];
  const wsName = (code: string | null) => lookups.workspaces.find((w) => w.code === code)?.name_ar ?? "عامة";

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <nav className="mb-2 text-sm text-gray-500" aria-label="مسار التنقّل">
        <Link href="/dashboard/tasks" className="hover:text-brand-700">المهام</Link> ‹ القوالب
      </nav>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">قوالب المهام</h1>
          <p className="mt-1 text-ink-muted">فيديو تسويقي، تهيئة موظف، تحصيل فاتورة… أنشئ القالب مرة واستعمله كل مرة.</p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Link href="/dashboard/tasks/settings" className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-brand-500">
              الإعدادات والأتمتة
            </Link>
          )}
          <Link href="/dashboard/tasks/templates/new" className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
            + قالب جديد
          </Link>
        </div>
      </header>

      {!lookups.ready && <NotReady />}

      <nav className="mb-4 flex flex-wrap gap-1.5 text-sm" aria-label="المساحات">
        <Link href="/dashboard/tasks/templates" className={`rounded-full border px-3 py-1 ${!ws ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line"}`}>الكل</Link>
        {lookups.workspaces.map((w) => (
          <Link key={w.code} href={`/dashboard/tasks/templates?workspace=${w.code}`}
            className={`rounded-full border px-3 py-1 ${ws === w.code ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line"}`}>{w.name_ar}</Link>
        ))}
      </nav>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        {templates.length === 0 ? (
          <EmptyState icon="library_add" text="لا قوالب هنا بعد." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => {
              const n = t.task_template_items?.[0]?.count ?? 0;
              const editable = canManage || (t.created_by === user.user?.id && !t.is_system);
              return (
                <li key={t.id} className={`dash-card p-4 ${t.is_active ? "" : "opacity-60"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-bold text-ink">{t.name_ar}</h2>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{wsName(t.workspace)}</span>
                  </div>
                  {t.description && <p className="mt-1 text-xs leading-5 text-ink-muted">{t.description}</p>}
                  <p className="mt-2 text-xs text-gray-500">
                    {n ? `${n} مهمة فرعية` : "مهمة واحدة"}
                    {t.checklist?.length ? ` · ${t.checklist.length} بند تحقق` : ""}
                    {t.requires_approval ? " · بموافقة" : ""}
                    {!t.is_active ? " · معطّل" : ""}
                  </p>
                  {editable && (
                    <Link href={`/dashboard/tasks/templates/${t.id}`} className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">تعديل</Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <TemplatePicker templates={templates.filter((t) => t.is_active)} prefill={{}} />
      </div>
    </main>
  );
}
