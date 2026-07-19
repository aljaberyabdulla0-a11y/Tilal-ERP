import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/auth";
import AppShell, { NavItem } from "./app-shell";

// التخطيط العام لكل صفحات النظام — يضيف الشريط الجانبي
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = await getUserRole();
  const admin = role === "admin";

  const nav: NavItem[] = [
    { href: "/dashboard", label: "لوحة التحكم", icon: "dashboard", prefixes: ["/dashboard"], exact: true },
    {
      href: "/dashboard/crm",
      label: "CRM",
      icon: "groups",
      prefixes: ["/dashboard/crm", "/dashboard/clients", "/dashboard/units", "/dashboard/reservations"],
    },
    ...(admin
      ? [{ href: "/dashboard/invoices", label: "الفواتير", icon: "receipt_long", prefixes: ["/dashboard/invoices"] }]
      : []),
    ...(admin
      ? [{ href: "/dashboard/accounting", label: "المحاسبة", icon: "account_balance_wallet", prefixes: ["/dashboard/accounting"] }]
      : []),
    { href: "/dashboard/hr", label: "HR", icon: "badge", prefixes: ["/dashboard/hr", "/dashboard/me"] },
    ...(admin
      ? [{ href: "/dashboard/settings", label: "الإعدادات", icon: "settings", prefixes: ["/dashboard/settings"] }]
      : []),
  ];

  return (
    <AppShell nav={nav} userEmail={user?.email ?? ""} roleLabel={admin ? "مدير" : "موظف"}>
      {children}
    </AppShell>
  );
}
