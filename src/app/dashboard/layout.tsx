import { getCurrentUser, getUserRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import AppShell, { NavItem } from "./app-shell";
import ChatWidget from "@/components/chat-widget";

// التخطيط العام لكل صفحات النظام — يضيف الشريط الجانبي
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // الثلاثة مخزّنة لكل طلب، فلا تكلّف رحلة شبكة إضافية
  const [user, role] = await Promise.all([getCurrentUser(), getUserRole()]);
  const t = getT();
  const admin = role === "admin";

  const nav: NavItem[] = [
    { href: "/dashboard", label: t.nav.dashboard, icon: "dashboard", prefixes: ["/dashboard"], exact: true },
    { href: "/dashboard/tasks", label: t.nav.tasks, icon: "checklist", prefixes: ["/dashboard/tasks"] },
    {
      href: "/dashboard/chat",
      label: t.nav.chat,
      icon: "chat",
      prefixes: ["/dashboard/chat"],
      badge: "chat",
    },
    {
      href: "/dashboard/crm",
      label: t.nav.crm,
      icon: "groups",
      prefixes: ["/dashboard/crm", "/dashboard/clients", "/dashboard/units", "/dashboard/reservations"],
    },
    ...(admin
      ? [{ href: "/dashboard/invoices", label: t.nav.invoices, icon: "receipt_long", prefixes: ["/dashboard/invoices"] }]
      : []),
    ...(admin
      ? [{ href: "/dashboard/accounting", label: t.nav.accounting, icon: "account_balance_wallet", prefixes: ["/dashboard/accounting"] }]
      : []),
    { href: "/dashboard/hr", label: t.nav.hr, icon: "badge", prefixes: ["/dashboard/hr", "/dashboard/me"] },
    ...(admin
      ? [{ href: "/dashboard/attendance", label: t.nav.attendance, icon: "schedule", prefixes: ["/dashboard/attendance"] }]
      : []),
    ...(admin
      ? [{ href: "/dashboard/settings", label: t.nav.settings, icon: "settings", prefixes: ["/dashboard/settings"] }]
      : []),
  ];

  return (
    <AppShell
      nav={nav}
      userEmail={user?.email ?? ""}
      roleLabel={admin ? t.nav.roleAdmin : t.nav.roleEmployee}
    >
      {children}
      {/* نافذة المحادثة المنبثقة — متاحة في كل صفحات النظام */}
      <ChatWidget myUserId={user?.id ?? ""} isAdmin={admin} />
    </AppShell>
  );
}
