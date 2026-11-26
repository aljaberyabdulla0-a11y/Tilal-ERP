import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageHr, isAdmin } from "@/lib/auth";
import ResponsibilitiesLibrary, { type CatalogRow, type ModuleRow } from "./library";

// مكتبة المسؤوليات التشغيلية (sql/229). HR والإدارة يديرون المكتبة، والمدير العام وحده يحدّد
// الصلاحيات التي تمنحها كل مسؤولية. التكليف نفسه من صفحة الموظف.
export default async function ResponsibilitiesPage() {
  const [hrCan, admin] = await Promise.all([canManageHr(), isAdmin()]);
  if (!hrCan) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: cat }, { data: deps }, { data: ras }, { data: perms }, { data: mods }] = await Promise.all([
    supabase.from("responsibility_catalog").select("*").is("archived_at", null).order("name_ar"),
    supabase.from("departments").select("id, name_ar, code").eq("status", "نشط").order("sort_order"),
    supabase.from("responsibility_assignments").select("responsibility_id, status")
      .in("status", ["active", "suspended", "pending_approval"]),
    supabase.from("responsibility_permissions").select("responsibility_id, module, actions, scope"),
    supabase.from("app_modules").select("code, name_ar").order("sort_order"),
  ]);

  const active: Record<string, number> = {};
  ((ras ?? []) as { responsibility_id: string }[]).forEach((r) => {
    active[r.responsibility_id] = (active[r.responsibility_id] ?? 0) + 1;
  });

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/hr" className="text-sm text-gray-500 hover:text-brand-700">
          ← الموارد البشرية
        </Link>
        <h1 className="text-xl font-bold text-brand-700">مكتبة المسؤوليات التشغيلية</h1>
      </header>
      <section className="p-6">
        <ResponsibilitiesLibrary
          catalog={(cat ?? []) as CatalogRow[]}
          departments={(deps ?? []) as { id: string; name_ar: string }[]}
          activeCounts={active}
          permissions={(perms ?? []) as { responsibility_id: string; module: string; actions: string[]; scope: string }[]}
          modules={((mods ?? []) as ModuleRow[]).filter((m) => !["permission_grants", "organization"].includes(m.code))}
          isAdmin={admin}
        />
      </section>
    </main>
  );
}
