import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { AppModule, Role, RolePermission } from "@/lib/org";
import RolesManager from "./roles-manager";

// الأدوار ومصفوفة الصلاحيات (sql/146) — للمدير وحده. من يمنح الصلاحيات
// لو مُنح ذلك بالمصفوفة نفسها لمنح نفسه المدير.
export default async function RolesPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: roles }, { data: mods }, { data: perms }, { data: profs }] = await Promise.all([
    supabase.from("roles").select("*").order("sort_order"),
    supabase.from("app_modules").select("*").order("sort_order"),
    supabase.from("role_permissions").select("role_code, module, actions, scope"),
    supabase.from("profiles").select("role_code"),
  ]);

  const counts: Record<string, number> = {};
  ((profs ?? []) as { role_code: string | null }[]).forEach((p) => {
    if (p.role_code) counts[p.role_code] = (counts[p.role_code] ?? 0) + 1;
  });

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-brand-700">
          ← الإعدادات
        </Link>
        <h1 className="text-xl font-bold text-brand-700">الأدوار والصلاحيات</h1>
      </header>
      <section className="p-6">
        <RolesManager
          roles={(roles ?? []) as Role[]}
          modules={(mods ?? []) as AppModule[]}
          permissions={(perms ?? []) as RolePermission[]}
          counts={counts}
        />
      </section>
    </main>
  );
}
