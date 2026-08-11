"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "./logout-button";
import Logo from "@/components/logo";
import NotificationBell from "@/components/notification-bell";
import ChatUnreadBadge from "@/components/chat-unread-badge";
import LanguageSwitcher from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/client";

export type NavItem = {
  href: string;
  label: string;
  icon: string; // اسم أيقونة Material Symbols
  prefixes: string[];
  exact?: boolean;
  badge?: "chat"; // شارة عدّاد بجانب الرابط
};

// ============================================================
// الهيكل العام: شريط جانبي زجاجي فاتح (نظام تصميم Stitch).
//
// ⚠️ كل الأصناف الاتجاهية هنا **منطقية** (start/end وليس right/left)
// حتى ينقلب الشريط تلقائياً إلى اليسار عند التبديل للإنجليزية.
// ============================================================
export default function AppShell({
  nav,
  userEmail,
  roleLabel,
  children,
}: {
  nav: NavItem[];
  userEmail: string;
  roleLabel: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { t } = useI18n();

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    return item.prefixes.some((p) => pathname.startsWith(p));
  }

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-e border-gray-200/70 bg-white/80 backdrop-blur-xl">
      {/* الشعار + جرس الإشعارات */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-200/60 px-4 py-4">
        <NotificationBell />
        <Logo width={150} />
      </div>

      {/* روابط التنقل */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={
              isActive(item)
                ? "flex items-center gap-3 rounded-xl bg-brand-50 px-3 py-2.5 font-bold text-brand-700"
                : "flex items-center gap-3 rounded-xl px-3 py-2.5 text-gray-500 transition hover:bg-gray-100 hover:text-brand-700"
            }
          >
            <span className="material-symbols-outlined text-xl">{item.icon}</span>
            <span>{item.label}</span>
            {item.badge === "chat" && <ChatUnreadBadge />}
          </Link>
        ))}
      </nav>

      {/* المستخدم + اللغة + الخروج */}
      <div className="border-t border-gray-200/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-700">
            <span className="material-symbols-outlined text-lg">person</span>
          </span>
          <div className="min-w-0">
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
              {roleLabel}
            </span>
            <div className="truncate text-[11px] text-gray-400" dir="ltr">
              {userEmail}
            </div>
          </div>
        </div>

        <div className="mb-2">
          <LanguageSwitcher />
        </div>

        <LogoutButton className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100" />
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* الشريط الجانبي — سطح المكتب (يمين في العربية، يسار في الإنجليزية) */}
      <div className="sticky top-0 hidden h-screen shrink-0 lg:block">{sidebar}</div>

      {/* الشريط الجانبي — الجوّال */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute start-0 top-0 h-full">{sidebar}</div>
        </div>
      )}

      {/* منطقة المحتوى */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* شريط علوي للجوّال */}
        <div className="flex items-center gap-3 border-b bg-white px-4 py-3 lg:hidden">
          <button
            onClick={() => setOpen(true)}
            className="material-symbols-outlined text-gray-700"
            aria-label={t.nav.menu}
          >
            menu
          </button>
          <span className="font-bold text-brand-700">{t.common.appName}</span>
          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitcher compact />
            <NotificationBell pin="end" />
          </div>
        </div>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
