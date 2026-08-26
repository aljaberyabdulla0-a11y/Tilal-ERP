import { getCurrentUser, getUserRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import AppShell, { NavItem } from "./app-shell";
import ChatWidget from "@/components/chat-widget";

// ============================================================
// التخطيط العام لكل صفحات النظام — يبني قائمة التنقّل حسب الدور.
//
// الأدوار الأربعة:
//   المدير       : كل شيء.
//   المشرف       : لوحة · مهام · محادثات · CRM · فواتير · HR · إعداداته.
//                  **بلا محاسبة وبلا قسم الدوام الإداري** — يرى نطاق
//                  مشروعه فقط، وسياسات القاعدة تفرض ذلك لا هذه القائمة.
//   مدير المتابعة: لوحة · مهام · محادثات · المخزون · الموظفون ·
//                  الاتصالات · إعداداته. **بلا محاسبة ولا فواتير ولا
//                  رواتب** — متابعة تشغيلية لا مالية (sql/040).
//   الموظف       : لوحة · مهام · محادثات · CRM · HR · إعداداته.
// ============================================================
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // الاثنان مخزّنان لكل طلب، فلا يكلّفان رحلة شبكة إضافية
  const [user, role] = await Promise.all([getCurrentUser(), getUserRole()]);
  const t = getT();

  const admin = role === "admin";
  const supervisor = role === "supervisor";
  const followup = role === "followup_manager";

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

    // المخزون: المدير ومدير المتابعة (نفس قاعدة can_manage_inventory)
    ...(admin || followup
      ? [{ href: "/dashboard/inventory", label: t.nav.inventory, icon: "inventory_2", prefixes: ["/dashboard/inventory"] }]
      : []),

    // مدير المتابعة: ملفّه التشغيلي — الموظفون والاتصالات.
    // (لا يظهر له CRM كاملاً: لا وحدات ولا حجوزات ولا فواتير.)
    ...(followup
      ? [
          { href: "/dashboard/followup/employees", label: t.nav.employees, icon: "supervisor_account", prefixes: ["/dashboard/followup/employees"] },
          { href: "/dashboard/clients/activities", label: t.nav.contacts, icon: "call", prefixes: ["/dashboard/clients"] },
        ]
      : []),

    ...(followup
      ? []
      : [
          {
            href: "/dashboard/crm",
            label: t.nav.crm,
            icon: "groups",
            prefixes: ["/dashboard/crm", "/dashboard/clients", "/dashboard/units", "/dashboard/reservations"],
          },
        ]),

    // فريقي — للمشرف وحده (المدير عنده شاشات الإدارة الكاملة)
    ...(supervisor
      ? [{ href: "/dashboard/team", label: t.nav.myTeam, icon: "supervisor_account", prefixes: ["/dashboard/team"] }]
      : []),

    // الفواتير: المدير يديرها، والمشرف يقرأ فواتير عملاء مشروعه
    ...(admin || supervisor
      ? [{ href: "/dashboard/invoices", label: t.nav.invoices, icon: "receipt_long", prefixes: ["/dashboard/invoices"] }]
      : []),

    // المحاسبة للمدير وحده — هنا الصرف وأرباح الشركة
    ...(admin
      ? [{ href: "/dashboard/accounting", label: t.nav.accounting, icon: "account_balance_wallet", prefixes: ["/dashboard/accounting"] }]
      : []),

    // HR: للمدير إدارة كاملة، ولغيره بوابته الشخصية (بصمة وإجازات).
    // مدير المتابعة يحتاجها كموظف مثل الجميع — ومتابعته لغيره في
    // شاشة «الموظفون» أعلاه.
    { href: "/dashboard/hr", label: t.nav.hr, icon: "badge", prefixes: ["/dashboard/hr", "/dashboard/me"] },

    ...(admin
      ? [{ href: "/dashboard/projects", label: t.nav.projects, icon: "apartment", prefixes: ["/dashboard/projects"] }]
      : []),
    ...(admin
      ? [{ href: "/dashboard/attendance", label: t.nav.attendance, icon: "schedule", prefixes: ["/dashboard/attendance"] }]
      : []),

    // الإعدادات: الإدارية للمدير، والشخصية لغيره
    admin
      ? { href: "/dashboard/settings", label: t.nav.settings, icon: "settings", prefixes: ["/dashboard/settings"] }
      : { href: "/dashboard/account", label: t.nav.settings, icon: "settings", prefixes: ["/dashboard/account"] },
  ];

  const roleLabel = admin
    ? t.nav.roleAdmin
    : supervisor
    ? t.nav.roleSupervisor
    : followup
    ? t.nav.roleFollowup
    : t.nav.roleEmployee;

  return (
    <AppShell nav={nav} userEmail={user?.email ?? ""} roleLabel={roleLabel}>
      {children}
      {/* نافذة المحادثة المنبثقة — متاحة في كل صفحات النظام */}
      <ChatWidget myUserId={user?.id ?? ""} isAdmin={admin} />
    </AppShell>
  );
}
