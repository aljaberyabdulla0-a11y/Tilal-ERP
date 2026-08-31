import { getCurrentUser, getUserRole, isAccountActive } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import AppShell, { NavItem } from "./app-shell";
import ChatWidget from "@/components/chat-widget";
import LogoutButton from "./logout-button";

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
//                  يستثنى من ذلك الاستقطاعات: يسجّلها على الموظفين
//                  وتُحتسب في كشف الراتب القادم (sql/041).
//   مدير العلاقات: لوحة · الوساطة (شركاته وليداتها وعمولاتها) ·
//                  مهام · محادثات · HR · إعداداته (sql/043).
//   شركة وسيطة   : **حساب خارجي** — لوحتها · ليداتها · استحقاقاتها ·
//                  إعداداتها. لا مهام ولا محادثات ولا CRM ولا HR،
//                  لأنها ليست موظفاً في تلال.
//   الموظف       : لوحة · مهام · محادثات · CRM · HR · إعداداته.
// ============================================================
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // الثلاثة مخزّنة لكل طلب، فلا تكلّف رحلات شبكة إضافية
  const [user, role, active] = await Promise.all([
    getCurrentUser(),
    getUserRole(),
    isAccountActive(),
  ]);
  const t = getT();

  // ============================================================
  // من أُنهيت خدمته لا يرى النظام.
  //
  // الحاجز هنا لا في الـ middleware لأن كل ما يُحمى تحت /dashboard،
  // والفحص في الـ middleware كان سيكلّف رحلة قاعدة مع كل ملفّ ثابت.
  // وهو حاجزُ عرضٍ فقط: سياسات القاعدة هي التي تمنع البيانات فعلاً
  // حتى لو نودِيت الواجهة مباشرة (sql/045).
  // ============================================================
  if (!active) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <span className="material-symbols-outlined mb-3 inline-flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-4xl text-gray-400">
            lock
          </span>
          <h1 className="mb-2 text-xl font-bold text-gray-800">
            انتهت خدمتك في الشركة
          </h1>
          <p className="mb-6 text-sm text-gray-500">
            سُلّمت ملفاتك إلى زميل يواصل متابعتها. إن كان هذا خطأً راجع الإدارة.
          </p>
          <LogoutButton className="w-full rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100" />
        </div>
      </main>
    );
  }

  const admin = role === "admin";
  const supervisor = role === "supervisor";
  const followup = role === "followup_manager";
  const broker = role === "broker";
  const rm = role === "relationship_manager";

  // ============================================================
  // الشركة الوسيطة: قائمة مستقلة تماماً.
  // بُنيت منفصلة لا بشروط داخل قائمة الموظفين، لأن كل بند في تلك
  // القائمة تقريباً لا يخصّها — والاستثناءات المتراكمة تُخفي بنداً
  // يوماً ما فيظهر لها ما ليس لها.
  // ============================================================
  if (broker) {
    const brokerNav: NavItem[] = [
      { href: "/dashboard", label: t.nav.dashboard, icon: "dashboard", prefixes: ["/dashboard"], exact: true },
      { href: "/dashboard/broker/leads", label: t.nav.ourLeads, icon: "groups", prefixes: ["/dashboard/broker/leads"] },
      { href: "/dashboard/broker/commissions", label: t.nav.ourCommissions, icon: "payments", prefixes: ["/dashboard/broker/commissions"] },
      { href: "/dashboard/account", label: t.nav.settings, icon: "settings", prefixes: ["/dashboard/account"] },
    ];

    return (
      <AppShell nav={brokerNav} userEmail={user?.email ?? ""} roleLabel={t.nav.roleBroker}>
        {children}
        {/* لا نافذة محادثات: المحادثات الداخلية بين موظفي تلال */}
      </AppShell>
    );
  }

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

    // الوساطة: المدير يديرها، ومدير العلاقات يرى شركاته منها
    ...(admin || rm
      ? [{ href: "/dashboard/brokers", label: t.nav.brokers, icon: "handshake", prefixes: ["/dashboard/brokers"] }]
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

    // المشاريع: المدير يديرها كلها، والمشرف يفتح مخزون مشروعه منها
    ...(admin || supervisor
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
    : rm
    ? t.nav.roleRm
    : t.nav.roleEmployee;

  return (
    <AppShell nav={nav} userEmail={user?.email ?? ""} roleLabel={roleLabel}>
      {children}
      {/* نافذة المحادثة المنبثقة — متاحة في كل صفحات النظام */}
      <ChatWidget myUserId={user?.id ?? ""} isAdmin={admin} />
    </AppShell>
  );
}
