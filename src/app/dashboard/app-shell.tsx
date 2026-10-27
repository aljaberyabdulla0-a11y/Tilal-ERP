"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "./logout-button";
import { BrandMark } from "@/components/logo";
import NotificationBell from "@/components/notification-bell";
import ChatUnreadBadge from "@/components/chat-unread-badge";
import LanguageSwitcher from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/client";
import CommandPalette, { type PaletteAction } from "@/components/dashboard/command-palette";

export type NavItem = {
  href: string;
  label: string;
  icon: string; // اسم أيقونة Material Symbols
  prefixes: string[];
  exact?: boolean;
  badge?: "chat"; // شارة عدّاد بجانب الرابط
};

// ============================================================
// الهيكل العام — التصميم المعتمد (feat/tilal-design-preview).
//
// القائمة نفسها تأتي من التخطيط على الخادم حسب الدور (layout.tsx) —
// هذا الملف يعرضها ولا يقرّر من يرى ماذا. والتغيير عرضٌ فقط:
//
//   • شريط جانبي بأخضر الشعار الداكن، مجمّع: الرئيسية ← العمل اليومي
//     ← الإدارة، والإعدادات في أسفله. التجميع بالمسار (groupOf) لا
//     بقائمةٍ ثانية، فأي بند يضيفه التخطيط يجد مكانه بلا تعديل هنا.
//   • البند النشط شريطٌ قائم على حافّته كبرج من أبراج الشعار.
//   • يُطوى إلى أيقونات على المكتب (يُحفظ في المتصفح)، ويصير درجاً
//     منزلقاً على الجوّال.
//   • شريط علوي مضغوط: موضع الصفحة، والبحث (Ctrl+K)، واللغة،
//     والإشعارات، وقائمة الحساب (البريد والدور والخروج).
//
// ⚠️ كل الأصناف الاتجاهية منطقية (start/end) فينقلب الهيكل كلّه
//    مع اللغة: يمين بالعربية، يسار بالإنجليزية.
// ============================================================

type Group = "home" | "daily" | "manage" | "footer";

const MANAGE_PREFIXES = [
  "/dashboard/finance", "/dashboard/hr", "/dashboard/me", "/dashboard/brokers",
  "/dashboard/inventory", "/dashboard/crm/reports",
];

function groupOf(item: NavItem): Group {
  if (item.href === "/dashboard") return "home";
  if (item.href.startsWith("/dashboard/settings") || item.href.startsWith("/dashboard/account")) return "footer";
  if (MANAGE_PREFIXES.some((p) => item.href.startsWith(p))) return "manage";
  return "daily";
}

const COLLAPSE_KEY = "tilal-sidebar-collapsed";

export default function AppShell({
  nav,
  userEmail,
  roleLabel,
  actions = [],
  children,
}: {
  nav: NavItem[];
  userEmail: string;
  roleLabel: string;
  /** إجراءات مركز الأوامر (Ctrl+K) — يقرّرها التخطيط على الخادم حسب الدور */
  actions?: PaletteAction[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // الطيّ راحةٌ لكل مستخدم في متصفحه — لا حالةٌ يُعتمد عليها
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* تخزين محجوب */ }
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* تخزين محجوب */ }
      return !c;
    });
  }

  // Esc يغلق الدرج — يغطّي الشاشة، فلا بدّ من مخرج بالمفتاح
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    return item.prefixes.some((p) => pathname.startsWith(p));
  }

  const current = nav.find(isActive);

  const sidebar = (mobile: boolean) => (
    <Sidebar
      nav={nav}
      isActive={isActive}
      collapsed={!mobile && collapsed}
      mobile={mobile}
      onToggle={mobile ? () => setOpen(false) : toggleCollapsed}
      onNavigate={() => setOpen(false)}
    />
  );

  return (
    <div className="flex min-h-screen bg-surface-subtle">
      {/* الشريط الجانبي — سطح المكتب (يمين في العربية، يسار في الإنجليزية) */}
      <div className={`sticky top-0 hidden h-screen shrink-0 transition-[width] duration-200 lg:block print:hidden ${collapsed ? "w-[76px]" : "w-64"}`}>
        {sidebar(false)}
      </div>

      {/* الشريط الجانبي — الجوّال: درج منزلق */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-brand-900/50" onClick={() => setOpen(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label={t.nav.menu} className="anim-drawer absolute inset-y-0 start-0 w-72 max-w-[85vw] shadow-overlay">
            {sidebar(true)}
          </div>
        </div>
      )}

      {/* منطقة المحتوى */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur print:hidden">
          <div className="flex h-14 items-center gap-2 px-4 lg:px-6">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="dash-focus -ms-2 flex h-9 w-9 items-center justify-center rounded-md text-ink-secondary transition hover:bg-surface-sunken hover:text-ink lg:hidden"
              aria-label={t.nav.menu}
            >
              <span aria-hidden="true" className="material-symbols-outlined">menu</span>
            </button>
            <nav aria-label="breadcrumb" className="min-w-0">
              <ol className="flex items-center gap-1.5 text-sm">
                <li className="hidden text-ink-muted sm:block">{t.nav.breadcrumbHome}</li>
                {current && (
                  <>
                    <li aria-hidden="true" className="hidden text-line-strong sm:block">/</li>
                    <li aria-current="page" className="truncate font-semibold text-ink">{current.label}</li>
                  </>
                )}
              </ol>
            </nav>
            <div className="ms-auto flex items-center gap-1 sm:gap-2">
              <CommandPalette actions={actions} />
              <div className="hidden sm:block"><LanguageSwitcher compact /></div>
              <NotificationBell pin="end" />
              <UserMenu email={userEmail} roleLabel={roleLabel} />
            </div>
          </div>
        </header>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

// ===== الشريط الجانبي =====

function Sidebar({
  nav, isActive, collapsed, mobile, onToggle, onNavigate,
}: {
  nav: NavItem[]; isActive: (i: NavItem) => boolean; collapsed: boolean; mobile: boolean;
  onToggle: () => void; onNavigate: () => void;
}) {
  const { t } = useI18n();
  const groups: { key: Group; label: string | null }[] = [
    { key: "home", label: null },
    { key: "daily", label: t.nav.groupDaily },
    { key: "manage", label: t.nav.groupManage },
  ];
  const footer = nav.filter((i) => groupOf(i) === "footer");

  return (
    <aside className="flex h-full flex-col bg-brand-900 text-white">
      <div className={`flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.07] ${collapsed ? "justify-center px-2" : "px-5"}`}>
        <Link href="/dashboard" onClick={onNavigate} aria-label={t.common.appName} className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
          <BrandMark size={collapsed ? 30 : 28} />
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[15px] font-bold">{t.common.appName}</span>
              <span className="block truncate text-[11px] text-white/55">{t.nav.tagline}</span>
            </span>
          )}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={mobile ? t.nav.closeMenu : t.nav.collapse}
            title={mobile ? t.nav.closeMenu : t.nav.collapse}
            className="ms-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <span aria-hidden="true" className={`material-symbols-outlined text-[20px] ${mobile ? "" : "rtl:-scale-x-100"}`}>
              {mobile ? "close" : "left_panel_close"}
            </span>
          </button>
        )}
      </div>

      <nav className="scroll-quiet flex-1 overflow-y-auto px-3 py-4">
        {groups.map((g, gi) => {
          const items = nav.filter((i) => groupOf(i) === g.key);
          if (items.length === 0) return null;
          return (
            <div key={g.key} className={gi > 0 ? "mt-5" : ""}>
              {g.label && (collapsed
                ? <div aria-hidden="true" className="mx-3 mb-3 h-px bg-white/10" />
                : <p className="mb-1.5 px-3 text-xs font-medium text-white/50">{g.label}</p>)}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} active={isActive(item)} collapsed={collapsed} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-white/[0.07] px-3 py-3">
        {footer.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item)} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
        {collapsed && (
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={onToggle}
              aria-label={t.nav.expand}
              title={t.nav.expand}
              className="flex h-9 w-9 items-center justify-center rounded-md text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[20px] rtl:-scale-x-100">left_panel_open</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function NavLink({ item, active, collapsed, onNavigate }: { item: NavItem; active: boolean; collapsed: boolean; onNavigate: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={`group relative flex h-10 items-center gap-3 rounded-md text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${collapsed ? "justify-center" : "px-3"} ${active ? "bg-white/[0.08] font-semibold text-white" : "text-white/70 hover:bg-white/[0.05] hover:text-white"}`}
    >
      {/* البرج: شريط قائم على حافّة البند النشط */}
      {active && <span aria-hidden="true" className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-brand-300" />}
      <span
        aria-hidden="true"
        className={`material-symbols-outlined text-[20px] ${active ? "text-brand-300" : ""}`}
        style={active ? { fontVariationSettings: '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24' } : undefined}
      >
        {item.icon}
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
      {item.badge === "chat" && (
        <span className={collapsed ? "absolute end-1 top-0.5" : "ms-auto"}>
          <ChatUnreadBadge />
        </span>
      )}
    </Link>
  );
}

// ===== قائمة الحساب =====

function UserMenu({ email, roleLabel }: { email: string; roleLabel: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (box.current && !box.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  const initial = (email.trim()[0] ?? "?").toUpperCase();

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={email || roleLabel}
        className="dash-focus flex h-9 items-center gap-2 rounded-md pe-1 ps-1 transition hover:bg-surface-sunken sm:pe-2"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{initial}</span>
        <span className="hidden text-[13px] font-semibold text-ink sm:block">{roleLabel}</span>
        <span aria-hidden="true" className="material-symbols-outlined hidden text-[18px] text-ink-muted sm:block">expand_more</span>
      </button>
      {open && (
        <div className="anim-pop absolute end-0 top-full z-40 mt-1.5 w-64 rounded-lg border border-line bg-surface shadow-overlay">
          <div className="border-b border-line px-4 py-3">
            <p dir="ltr" className="truncate text-start text-[13px] font-semibold text-ink">{email}</p>
            <p className="mt-1">
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">{roleLabel}</span>
            </p>
          </div>
          <div className="p-1">
            <Link
              href="/dashboard/account"
              onClick={close}
              className="dash-focus flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink hover:bg-surface-subtle"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-ink-muted">manage_accounts</span>
              {t.nav.account}
            </Link>
            <div className="sm:hidden px-2.5 py-2"><LanguageSwitcher /></div>
            <div className="flex items-center gap-2.5 rounded-md px-2.5 text-sm text-danger-700 hover:bg-danger-50">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] rtl:-scale-x-100">logout</span>
              <LogoutButton className="dash-focus flex-1 rounded py-2 text-start" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
