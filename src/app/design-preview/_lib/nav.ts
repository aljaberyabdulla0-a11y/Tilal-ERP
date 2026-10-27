import type { Dictionary } from "@/lib/i18n/dictionaries/ar";
import type { PreviewCopy } from "./copy";

// ============================================================
// قائمة المعاينة — نسخة **المدير** من قائمة النظام (dashboard/layout.tsx)
// بنفس البنود والمسارات والترتيب، مجمّعةً كما يصفها تعليق ذلك الملف:
// العمل اليومي ← الإدارة ← الإعدادات.
//
// المعاينة مقصورة على المدير (layout.tsx هنا)، فقائمته هي الصحيحة.
// ولا تُكرَّر هنا منطق الأدوار الأخرى: حين يُرقّى التصميم تُبنى القائمة
// من نفس دالّة الإنتاج، لا من هذا الملف.
//
// الأبناء (CRM، المالية، HR) شاشاتٌ قائمة فعلاً تحت تلك البوابات —
// كانت تُفتح من ألسنة داخل البوابة، وهنا تظهر في القائمة نفسها.
// ============================================================

export type NavLeaf = { key: string; href: string; label: string; icon?: string };
export type NavNode = NavLeaf & { icon: string; children?: NavLeaf[]; badge?: number; preview?: boolean };
export type NavGroup = { key: string; label: string | null; items: NavNode[] };

export const PREVIEW_HOME = "/design-preview";

export function buildNav(t: Dictionary, p: PreviewCopy): { groups: NavGroup[]; footer: NavNode } {
  const n = t.nav;
  const s = p.sub;
  return {
    groups: [
      {
        key: "home",
        label: null,
        items: [{ key: "dashboard", href: PREVIEW_HOME, label: n.dashboard, icon: "space_dashboard", preview: true }],
      },
      {
        key: "daily",
        label: p.groups.daily,
        items: [
          {
            key: "crm", href: "/dashboard/crm", label: n.crm, icon: "groups",
            children: [
              { key: "crm-overview", href: "/dashboard/crm", label: s.crmOverview },
              { key: "clients", href: "/dashboard/clients", label: s.clients },
              { key: "units", href: "/dashboard/units", label: s.units },
              { key: "reservations", href: "/dashboard/reservations", label: s.reservations },
            ],
          },
          { key: "projects", href: "/dashboard/projects", label: n.projects, icon: "apartment" },
          { key: "tasks", href: "/dashboard/tasks", label: n.tasks, icon: "checklist" },
          { key: "chat", href: "/dashboard/chat", label: n.chat, icon: "forum", badge: 3 },
          { key: "marketing", href: "/dashboard/marketing", label: n.marketing, icon: "campaign" },
        ],
      },
      {
        key: "manage",
        label: p.groups.manage,
        items: [
          {
            key: "finance", href: "/dashboard/finance", label: n.finance, icon: "account_balance",
            children: [
              { key: "invoices", href: "/dashboard/invoices", label: n.invoices },
              { key: "commissions", href: "/dashboard/commissions", label: n.commissions },
              { key: "accounting", href: "/dashboard/accounting", label: n.accounting },
            ],
          },
          {
            key: "hr", href: "/dashboard/hr", label: n.hr, icon: "badge",
            children: [
              { key: "employees", href: "/dashboard/hr/employees", label: s.employees },
              { key: "attendance", href: "/dashboard/hr/attendance", label: s.attendance },
              { key: "leaves", href: "/dashboard/hr/leaves", label: s.leaves },
              { key: "payroll", href: "/dashboard/hr/payroll", label: s.payroll },
            ],
          },
          { key: "brokers", href: "/dashboard/brokers", label: n.brokers, icon: "handshake" },
          { key: "inventory", href: "/dashboard/inventory", label: n.inventory, icon: "inventory_2" },
        ],
      },
    ],
    footer: { key: "settings", href: "/dashboard/settings", label: n.settings, icon: "settings" },
  };
}

// كل الأوراق مسطّحةً — لمركز البحث
export function flatLeaves(groups: NavGroup[], footer: NavNode): (NavLeaf & { icon: string; parent?: string })[] {
  const out: (NavLeaf & { icon: string; parent?: string })[] = [];
  for (const g of groups) {
    for (const it of g.items) {
      if (it.children) for (const c of it.children) out.push({ ...c, icon: it.icon, parent: it.label });
      else out.push(it);
    }
  }
  out.push(footer);
  return out;
}
