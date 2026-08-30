"use client";

import { useEffect, useState } from "react";
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
// الهيكل العام — نظام تصميم "Emerald Executive".
//
// شريط جانبي أخضر غامق (#064E3B) بعرض 256px، البند النشط فيه حبّة
// نعناعية، وشريط علوي زجاجي رفيع يحمل الإشعارات واللغة والمستخدم.
// الشريط الجانبي عمود قائم بذاته (h-screen + sticky) فلا تظهر فجوة
// بيضاء تحته مهما طالت الصفحة.
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

  // Esc يغلق القائمة — صارت تغطّي الشاشة، فلا بدّ من مخرج بالمفتاح
  // لا بالفأرة وحدها.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    return item.prefixes.some((p) => pathname.startsWith(p));
  }

  const sidebar = (
    <aside className="flex h-full w-64 flex-col bg-brand-600 text-white">
      {/* الشعار */}
      <div className="px-5 pb-5 pt-6">
        <Logo width={150} onDark />
        <p className="mt-2 text-[11px] font-medium text-brand-200/80">
          {t.nav.tagline}
        </p>
      </div>

      {/* روابط التنقل */}
      <nav className="scrollbar-hide flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={
              isActive(item)
                ? "flex items-center gap-3 rounded-full bg-brand-300 px-4 py-2.5 font-bold text-brand-700 shadow-sm"
                : "flex items-center gap-3 rounded-full px-4 py-2.5 font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
            }
          >
            <span className="material-symbols-outlined text-xl">{item.icon}</span>
            <span>{item.label}</span>
            {item.badge === "chat" && <ChatUnreadBadge />}
          </Link>
        ))}
      </nav>

      {/* المستخدم + الخروج */}
      <div className="border-t border-white/10 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white">
            <span className="material-symbols-outlined text-lg">person</span>
          </span>
          <div className="min-w-0">
            <span className="rounded-full bg-brand-300 px-2 py-0.5 text-[11px] font-bold text-brand-700">
              {roleLabel}
            </span>
            <div className="truncate text-[11px] text-white/50" dir="ltr">
              {userEmail}
            </div>
          </div>
        </div>

        <LogoutButton className="w-full rounded-xl border border-white/20 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white" />
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
          <div className="absolute start-0 top-0 h-full shadow-2xl">{sidebar}</div>
        </div>
      )}

      {/* منطقة المحتوى */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* الشريط العلوي — على كل المقاسات */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200/70 bg-white/80 px-4 py-3 backdrop-blur-xl lg:px-6">
          <button
            onClick={() => setOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-700 transition hover:bg-gray-100 hover:text-brand-600 lg:hidden"
            aria-label={t.nav.menu}
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
          <span className="font-bold text-brand-600">{t.common.appName}</span>
          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitcher compact />
            <NotificationBell pin="end" />
          </div>
        </header>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
