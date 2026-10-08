import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { getDashboardPeople } from "@/lib/dashboard/data";
import { ErrorState } from "@/components/dashboard/states";
import { Icon } from "@/components/dashboard/ui";
import PeopleEditor, { type Person } from "./people-editor";

// ============================================================
// /dashboard/settings/dashboards — لوحة كل شخص (للمدير).
//
// القائمة من dashboard_people (184): لكل حساب لوحاته التلقائية (من المنصب
// والعلاقات)، وتخصيصك إن وُجد، وتنبيهٌ حين يقترح المنصب دوراً أوسع من
// دور الحساب. الحماية في القاعدة: الدالّة ترفض غير المدير.
// ============================================================
export default async function DashboardsSettingsPage() {
  if (!(await isAdmin())) redirect("/dashboard");
  const { t } = getI18n();
  const p = t.dash.people;
  const people = await getDashboardPeople();

  return (
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
      <Link href="/dashboard/settings" className="dash-focus mb-3 inline-flex items-center gap-1 rounded text-sm text-ink-secondary hover:text-brand-700">
        <Icon name="arrow_back" className="text-[18px] rtl:rotate-180" />
        {t.nav.settings}
      </Link>
      <h1 className="text-2xl font-bold text-ink">{p.title}</h1>
      <p className="mb-2 mt-1 max-w-3xl text-sm text-ink-secondary">{p.intro}</p>
      <Link href="/dashboard/settings/roles" className="dash-focus mb-5 inline-flex items-center gap-1 rounded text-sm font-semibold text-brand-700 hover:underline">
        <Icon name="admin_panel_settings" className="text-[18px]" />
        {p.rolesLink}
      </Link>
      {people.ok ? (
        <PeopleEditor people={people.data as Person[]} />
      ) : (
        <ErrorState detail={people.error} />
      )}
    </main>
  );
}
