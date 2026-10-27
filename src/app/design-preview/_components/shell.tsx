"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from "@/lib/i18n/config";
import { fill, fmtRelative } from "@/lib/dashboard/format";
import LogoutButton from "@/app/dashboard/logout-button";
import { previewCopy, type PreviewCopy } from "../_lib/copy";
import { buildNav, flatLeaves, PREVIEW_HOME, type NavLeaf, type NavNode } from "../_lib/nav";
import { MOCK_NOTIFICATIONS, MOCK_PROJECTS, MOCK_SOURCES } from "../_lib/mock-data";
import {
  Button, Dialog, Field, Icon, IconButton, INPUT, Popover, Segmented, Select, ToastProvider, Tooltip, useToast,
} from "./ui";

// ============================================================
// هيكل المعاينة: شريط جانبي، وشريط علوي، وشريط «معاينة» يعلن أن
// الأرقام تجريبية، ومركز بحث (Ctrl+K)، وحوار «ليد جديد».
//
// ما يختلف عن الهيكل القائم (dashboard/app-shell.tsx):
//   • القائمة مجمّعة (العمل اليومي / الإدارة) والبوابات تتفتّح لأبنائها.
//   • الشريط يُطوى إلى أيقونات على المكتب، ويُحفظ اختيارك في المتصفح.
//   • البند النشط شريطٌ قائم على حافّته كبرج من أبراج الشعار، لا حبّة.
//   • الشعار علامة البرج وحدها بجانب اسم النظام — لا الشعار المرصوص
//     كاملاً الذي كان يأكل 130px من أعلى القائمة.
//
// ⚠️ لا شيء هنا يكتب إلى القاعدة. ما سوى لوحة التحكم من بنود القائمة
//    يفتح لوحة «هذه الشاشة باقية بتصميمها الحالي» برابطٍ إليها.
// ============================================================

export type DataState = "ready" | "loading" | "empty" | "error";

type PreviewCtx = {
  p: PreviewCopy;
  dataState: DataState;
  setDataState: (s: DataState) => void;
  openNewLead: () => void;
  unavailable: (action: string) => void;
};

const Ctx = createContext<PreviewCtx | null>(null);
export function usePreview(): PreviewCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePreview outside PreviewShell");
  return v;
}

const COLLAPSE_KEY = "tp-sidebar-collapsed";

// علامة البرج من الشعار نفسه (logo-white.png) — قصٌّ بالـCSS لا ملفٌّ جديد.
// إحداثيات العلامة في الصورة: أفقياً 23.4%–76.7%، وعمودياً أعلى 53%.
function BrandMark({ size }: { size: number }) {
  const w = size / 0.533;
  return (
    <span dir="ltr" className="relative block shrink-0 overflow-hidden" style={{ width: size, height: size * 1.01 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-white.png" alt="" className="absolute top-0 max-w-none" style={{ width: w, left: -0.234 * w }} />
    </span>
  );
}

export default function PreviewShell({
  email, roleLabel, children,
}: { email: string; roleLabel: string; children: ReactNode }) {
  return (
    <ToastProvider>
      <ShellInner email={email} roleLabel={roleLabel}>{children}</ShellInner>
    </ToastProvider>
  );
}

function ShellInner({ email, roleLabel, children }: { email: string; roleLabel: string; children: ReactNode }) {
  const { locale, t } = useI18n();
  const p = previewCopy(locale);
  const toast = useToast();
  const pathname = usePathname();
  const { groups, footer } = useMemo(() => buildNav(t, p), [t, p]);

  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [outside, setOutside] = useState<NavLeaf | null>(null);
  const [dataState, setDataState] = useState<DataState>("ready");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);

  // الاختيار محفوظ للمستخدم وحده في متصفحه — راحةٌ لا حالةٌ يُعتمد عليها
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* تخزين محجوب */ }
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* تخزين محجوب */ }
      return !c;
    });
  }

  useEffect(() => { setOutside(null); setDrawer(false); }, [pathname]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); }
      if (e.key === "Escape") setDrawer(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const unavailable = useCallback(
    (action: string) => toast({ tone: "info", message: fill(p.unavailable, { action }) }),
    [toast, p.unavailable]
  );

  const ctx: PreviewCtx = {
    p, dataState, setDataState, unavailable,
    openNewLead: () => setLeadOpen(true),
  };

  function go(leaf: NavLeaf) {
    setDrawer(false);
    setPaletteOpen(false);
    setOutside(leaf.href === PREVIEW_HOME ? null : leaf);
  }

  const activeKey = outside?.key ?? (pathname === PREVIEW_HOME ? "dashboard" : null);
  const crumb = outside ? outside.label : pathname?.startsWith(`${PREVIEW_HOME}/system`) ? p.system.title : p.executive;

  const sidebar = (mobile: boolean) => (
    <Sidebar
      groups={groups}
      footer={footer}
      activeKey={activeKey}
      collapsed={!mobile && collapsed}
      mobile={mobile}
      onToggle={mobile ? () => setDrawer(false) : toggleCollapsed}
      onPick={go}
      p={p}
      tagline={t.nav.tagline}
      appName={t.common.appName}
    />
  );

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex min-h-screen">
        <div className={`sticky top-0 hidden h-screen shrink-0 transition-[width] duration-200 lg:block ${collapsed ? "w-[76px]" : "w-[264px]"}`}>
          {sidebar(false)}
        </div>

        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-tp-forest-950/50" onClick={() => setDrawer(false)} aria-hidden="true" />
            <div role="dialog" aria-modal="true" aria-label={t.nav.menu} className="tp-drawer absolute inset-y-0 start-0 w-[288px] max-w-[85vw] shadow-tp-overlay">
              {sidebar(true)}
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <PreviewRibbon p={p} dataState={dataState} setDataState={setDataState} pathname={pathname ?? ""} />
          <Header
            p={p}
            crumb={crumb}
            email={email}
            roleLabel={roleLabel}
            onMenu={() => setDrawer(true)}
            onSearch={() => setPaletteOpen(true)}
            onSettings={() => go(footer)}
          />
          <main className="min-w-0 flex-1">
            {outside ? <OutsidePanel leaf={outside} p={p} onBack={() => setOutside(null)} /> : children}
          </main>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        leaves={flatLeaves(groups, footer)}
        p={p}
        onPick={go}
        onNewLead={() => { setPaletteOpen(false); setLeadOpen(true); }}
        newLeadLabel={t.dash.actions.newLead}
      />
      <NewLeadDialog open={leadOpen} onClose={() => setLeadOpen(false)} />
    </Ctx.Provider>
  );
}

// ===== الشريط الجانبي =====

function Sidebar({
  groups, footer, activeKey, collapsed, mobile, onToggle, onPick, p, tagline, appName,
}: {
  groups: ReturnType<typeof buildNav>["groups"]; footer: NavNode; activeKey: string | null;
  collapsed: boolean; mobile: boolean; onToggle: () => void; onPick: (l: NavLeaf) => void;
  p: PreviewCopy; tagline: string; appName: string;
}) {
  // البوابة التي فيها البند النشط مفتوحة دائماً، والباقي بحسب اختيارك
  const owner = groups.flatMap((g) => g.items).find((it) => it.children?.some((c) => c.key === activeKey))?.key;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const isOpen = (k: string) => open.has(k) || k === owner;
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  return (
    <aside className="flex h-full flex-col bg-tp-forest-900 text-white">
      <div className={`flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.07] ${collapsed ? "justify-center px-2" : "px-5"}`}>
        <Link href={PREVIEW_HOME} aria-label={appName} className="tp-focus-dark flex min-w-0 items-center gap-3 rounded-md" onClick={() => onPick({ key: "dashboard", href: PREVIEW_HOME, label: "" })}>
          <BrandMark size={collapsed ? 30 : 28} />
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[15px] font-bold">{appName}</span>
              <span className="block truncate text-[11px] text-white/55">{tagline}</span>
            </span>
          )}
        </Link>
        {!collapsed && (
          <IconButton
            dark
            icon={mobile ? "close" : "left_panel_close"}
            label={mobile ? p.closeMenu : p.collapse}
            onClick={onToggle}
            className={`ms-auto ${mobile ? "" : "rtl:-scale-x-100"}`}
          />
        )}
      </div>

      <nav aria-label={p.title} className="tp-scroll-quiet flex-1 overflow-y-auto px-3 py-4">
        {groups.map((g, gi) => (
          <div key={g.key} className={gi > 0 ? "mt-5" : ""}>
            {g.label && (collapsed
              ? <div aria-hidden="true" className="mx-3 mb-3 h-px bg-white/10" />
              : <p className="mb-1.5 px-3 text-xs font-medium text-white/50">{g.label}</p>)}
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.key}>
                  <NavItem
                    item={it}
                    activeKey={activeKey}
                    collapsed={collapsed}
                    expanded={isOpen(it.key)}
                    onToggle={() => {
                      if (collapsed) { onToggle(); setOpen((s) => new Set(s).add(it.key)); }
                      else toggle(it.key);
                    }}
                    onPick={onPick}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/[0.07] px-3 py-3">
        <NavItem item={footer} activeKey={activeKey} collapsed={collapsed} expanded={false} onToggle={() => {}} onPick={onPick} />
        {collapsed && (
          <div className="mt-2 flex justify-center">
            <IconButton dark icon="left_panel_open" label={p.expand} onClick={onToggle} className="rtl:-scale-x-100" />
          </div>
        )}
      </div>
    </aside>
  );
}

const ROW = "tp-focus-dark group relative flex w-full items-center gap-3 rounded-md text-[14px] transition-colors";

function NavItem({
  item, activeKey, collapsed, expanded, onToggle, onPick,
}: {
  item: NavNode; activeKey: string | null; collapsed: boolean; expanded: boolean;
  onToggle: () => void; onPick: (l: NavLeaf) => void;
}) {
  const childActive = item.children?.some((c) => c.key === activeKey) ?? false;
  const active = item.key === activeKey;
  const lit = active || (childActive && (collapsed || !expanded));
  const cls = `${ROW} ${collapsed ? "h-10 justify-center" : "h-10 px-3"} ${lit ? "bg-white/[0.08] font-semibold text-white" : "text-white/70 hover:bg-white/[0.05] hover:text-white"}`;

  // البرج: شريط قائم على حافّة البند النشط
  const tower = lit && <span aria-hidden="true" className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-tp-mint-300" />;
  const badge = item.badge ? (
    collapsed
      ? <span className="absolute end-2 top-2 h-2 w-2 rounded-full bg-tp-mint-300 ring-2 ring-tp-forest-900" />
      : <span className="tp-tabular ms-auto rounded-full bg-tp-mint-300 px-1.5 text-[11px] font-bold text-tp-forest-950">{item.badge}</span>
  ) : null;

  const inner = (
    <>
      {tower}
      <Icon name={item.icon} className={`text-[20px] ${lit ? "text-tp-mint-300" : ""}`} filled={lit} />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {badge}
      {!collapsed && item.children && (
        <Icon name="expand_more" className={`ms-auto text-[18px] text-white/50 transition-transform ${expanded ? "rotate-180" : ""}`} />
      )}
    </>
  );

  const control = item.children ? (
    <button type="button" aria-expanded={collapsed ? undefined : expanded} onClick={onToggle} className={cls}>{inner}</button>
  ) : item.preview ? (
    <Link href={item.href} aria-current={active ? "page" : undefined} onClick={() => onPick(item)} className={cls}>{inner}</Link>
  ) : (
    <button type="button" aria-current={active ? "page" : undefined} onClick={() => onPick(item)} className={cls}>{inner}</button>
  );

  return (
    <>
      {collapsed ? <Tooltip label={item.label} side="end">{control}</Tooltip> : control}
      {!collapsed && item.children && expanded && (
        <ul className="mb-1 ms-[22px] mt-0.5 space-y-0.5 border-s border-white/10 ps-3">
          {item.children.map((c) => {
            const on = c.key === activeKey;
            return (
              <li key={c.key}>
                <button
                  type="button"
                  aria-current={on ? "page" : undefined}
                  onClick={() => onPick(c)}
                  className={`tp-focus-dark flex h-8 w-full items-center rounded-md px-2.5 text-[13px] transition-colors ${on ? "bg-white/[0.08] font-semibold text-tp-mint-300" : "text-white/65 hover:bg-white/[0.05] hover:text-white"}`}
                >
                  {c.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ===== شريط المعاينة =====

const STATES = ["ready", "loading", "empty", "error"] as const;

function PreviewRibbon({
  p, dataState, setDataState, pathname,
}: { p: PreviewCopy; dataState: DataState; setDataState: (s: DataState) => void; pathname: string }) {
  const onSystem = pathname.startsWith(`${PREVIEW_HOME}/system`);
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`tp-focus rounded px-2 py-1 text-xs font-semibold transition-colors ${on ? "bg-tp-surface text-tp-forest-700 shadow-[0_1px_2px_rgba(17,36,26,0.08)]" : "text-tp-ink-2 hover:text-tp-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="border-b border-dashed border-tp-line-strong bg-tp-mint-50 print:hidden">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-xs text-tp-ink-2">
          <Icon name="science" className="text-[16px] text-tp-forest-700" />
          {/* على الجوّال سطرٌ قصير لا فقرة: الشريط أداة معاينة لا محتوى */}
          <span className="font-semibold sm:hidden">{p.mockBadge}</span>
          <span className="hidden sm:inline">{p.ribbon}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label={p.title} className="flex rounded-md bg-tp-sunken p-0.5">
            {tab(PREVIEW_HOME, p.pages.dashboard, !onSystem)}
            {tab(`${PREVIEW_HOME}/system`, p.pages.system, onSystem)}
          </nav>
          {!onSystem && (
            <>
              <div className="hidden sm:block">
                <Segmented
                  size="sm"
                  label={p.dataState.label}
                  value={dataState}
                  onChange={setDataState}
                  options={STATES.map((v) => ({ value: v, label: p.dataState[v] }))}
                />
              </div>
              <Select aria-label={p.dataState.label} value={dataState} onChange={(v) => setDataState(v as DataState)} className="sm:hidden [&>select]:h-8 [&>select]:text-xs">
                {STATES.map((v) => <option key={v} value={v}>{p.dataState[v]}</option>)}
              </Select>
            </>
          )}
          <Link href="/dashboard" aria-label={p.exit} className="tp-focus inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-tp-forest-700 hover:underline">
            <Icon name="logout" className="text-[16px] rtl:-scale-x-100" />
            <span className="hidden sm:inline">{p.exit}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ===== الشريط العلوي =====

function Header({
  p, crumb, email, roleLabel, onMenu, onSearch, onSettings,
}: {
  p: PreviewCopy; crumb: string; email: string; roleLabel: string;
  onMenu: () => void; onSearch: () => void; onSettings: () => void;
}) {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-30 border-b border-tp-line bg-tp-surface/95 backdrop-blur print:hidden">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-4 sm:px-6 lg:px-8">
        <IconButton icon="menu" label={t.nav.menu} onClick={onMenu} className="-ms-2 lg:hidden" />
        <nav aria-label="breadcrumb" className="min-w-0">
          <ol className="flex items-center gap-1.5 text-sm">
            <li className="hidden text-tp-ink-3 sm:block">{p.home}</li>
            <li aria-hidden="true" className="hidden text-tp-line-strong sm:block">/</li>
            <li aria-current="page" className="truncate font-semibold text-tp-ink">{crumb}</li>
          </ol>
        </nav>

        <div className="ms-auto flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={onSearch}
            className="tp-focus hidden h-9 w-64 items-center gap-2 rounded-md border border-tp-line bg-tp-paper px-3 text-start text-[13px] text-tp-ink-3 transition-colors hover:border-tp-line-strong md:flex xl:w-80"
          >
            <Icon name="search" className="text-[18px]" />
            <span className="flex-1 truncate">{p.search}</span>
            <kbd dir="ltr" className="rounded border border-tp-line bg-tp-surface px-1.5 font-sans text-[11px] text-tp-ink-3">Ctrl K</kbd>
          </button>
          <IconButton icon="search" label={p.search} onClick={onSearch} className="md:hidden" />
          <LangSwitch />
          <Notifications p={p} />
          <UserMenu email={email} roleLabel={roleLabel} p={p} onSettings={onSettings} />
        </div>
      </div>
    </header>
  );
}

// نفس آلية مبدّل النظام (language-switcher.tsx): كوكي ثم إعادة رسم من الخادم
function LangSwitch() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [pending, setPending] = useState(false);
  function pick(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    setPending(true);
    router.refresh();
  }
  useEffect(() => setPending(false), [locale]);
  return (
    <div className={`hidden sm:block ${pending ? "opacity-60" : ""}`}>
      <Segmented
        size="sm"
        label={t.nav.language}
        value={locale}
        onChange={pick}
        options={LOCALES.map((l) => ({ value: l, label: l === "ar" ? "ع" : "EN" }))}
      />
    </div>
  );
}

function Notifications({ p }: { p: PreviewCopy }) {
  const { locale } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Set<string>>(new Set());
  const close = useCallback(() => setOpen(false), []);
  const unread = MOCK_NOTIFICATIONS.filter((n) => n.unread && !read.has(n.id)).length;
  const now = useMemo(() => new Date(), []);
  return (
    <Popover
      open={open}
      onClose={close}
      className="w-[min(22rem,calc(100vw-2rem))]"
      button={
        <IconButton icon="notifications" label={`${p.notifications.title}${unread ? ` — ${fill(p.notifications.unread, { n: unread })}` : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {unread > 0 && <span className="tp-tabular absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-tp-neg px-1 text-[10px] font-bold text-white ring-2 ring-tp-surface">{unread}</span>}
        </IconButton>
      }
    >
      <div className="flex items-center justify-between gap-3 border-b border-tp-line px-4 py-3">
        <p className="text-sm font-bold text-tp-ink">{p.notifications.title}</p>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => { setRead(new Set(MOCK_NOTIFICATIONS.map((n) => n.id))); toast({ tone: "info", message: p.notifications.marked }); }}
            className="tp-focus rounded text-xs font-semibold text-tp-forest-700 hover:underline"
          >
            {p.notifications.markRead}
          </button>
        )}
      </div>
      <ul className="max-h-[60vh] divide-y divide-tp-line overflow-y-auto">
        {MOCK_NOTIFICATIONS.map((n) => {
          const isUnread = n.unread && !read.has(n.id);
          return (
            <li key={n.id} className={`flex gap-3 px-4 py-3 ${isUnread ? "bg-tp-mint-50/60" : ""}`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-tp-sunken text-tp-ink-2">
                <Icon name={n.icon} className="text-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-tp-ink">{n.title[locale]}</p>
                <p className="mt-0.5 text-[13px] text-tp-ink-2">{n.body[locale]}</p>
                <p className="mt-1 text-[11px] text-tp-ink-3">{fmtRelative(new Date(now.getTime() - n.minutesAgo * 60000).toISOString(), locale, now)}</p>
              </div>
              {isUnread && <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-tp-forest-700" />}
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}

function UserMenu({ email, roleLabel, p, onSettings }: { email: string; roleLabel: string; p: PreviewCopy; onSettings: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const initial = (email.trim()[0] ?? "?").toUpperCase();
  return (
    <Popover
      open={open}
      onClose={close}
      className="w-64"
      button={
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="true"
          aria-label={email}
          onClick={() => setOpen((o) => !o)}
          className="tp-focus flex h-9 items-center gap-2 rounded-md ps-1 pe-1 transition-colors hover:bg-tp-sunken sm:pe-2"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-tp-forest-700 text-xs font-bold text-white">{initial}</span>
          <span className="hidden text-[13px] font-semibold text-tp-ink sm:block">{roleLabel}</span>
          <Icon name="expand_more" className="hidden text-[18px] text-tp-ink-3 sm:block" />
        </button>
      }
    >
      <div className="border-b border-tp-line px-4 py-3">
        <p dir="ltr" className="truncate text-start text-[13px] font-semibold text-tp-ink">{email}</p>
        <p className="mt-0.5 text-xs text-tp-ink-3">{p.account.role}: {roleLabel}</p>
      </div>
      <div className="p-1">
        <button type="button" onClick={() => { setOpen(false); onSettings(); }} className="tp-focus flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm text-tp-ink hover:bg-tp-paper">
          <Icon name="manage_accounts" className="text-[18px] text-tp-ink-3" />
          {p.account.settings}
        </button>
        <div className="flex items-center gap-2.5 rounded-md px-2.5 text-sm text-tp-neg hover:bg-tp-neg-bg">
          <Icon name="logout" className="text-[18px] rtl:-scale-x-100" />
          {/* زرّ الخروج القائم نفسه — جلسة حقيقية تُنهى، لا محاكاة */}
          <LogoutButton className="tp-focus flex-1 py-2 text-start" />
        </div>
      </div>
    </Popover>
  );
}

// ===== لوحة «باقية بتصميمها الحالي» =====

function OutsidePanel({ leaf, p, onBack }: { leaf: NavLeaf; p: PreviewCopy; onBack: () => void }) {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-lg rounded-xl border border-tp-line bg-tp-surface px-6 py-10 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-tp-mint-50 text-tp-forest-700">
          <Icon name="construction" className="text-[24px]" />
        </span>
        <h1 className="text-lg font-bold text-tp-ink">{p.outside.title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-tp-ink-2">{fill(p.outside.body, { name: leaf.label })}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href={leaf.href} className="tp-focus inline-flex h-9 items-center gap-2 rounded-md bg-tp-forest-700 px-3.5 text-sm font-semibold text-white hover:bg-tp-forest-600">
            <Icon name="open_in_new" className="text-[18px]" />
            {fill(p.outside.open, { name: leaf.label })}
          </Link>
          <Button variant="secondary" onClick={onBack}>{p.outside.back}</Button>
        </div>
      </div>
    </div>
  );
}

// ===== مركز البحث (Ctrl+K) =====

function CommandPalette({
  open, onClose, leaves, p, onPick, onNewLead, newLeadLabel,
}: {
  open: boolean; onClose: () => void; leaves: (NavLeaf & { icon: string; parent?: string })[]; p: PreviewCopy;
  onPick: (l: NavLeaf) => void; onNewLead: () => void; newLeadLabel: string;
}) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(""); setI(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
  const results = useMemo(() => {
    const needle = norm(q.trim());
    const items: { key: string; label: string; icon: string; meta?: string; run: () => void; group: "screens" | "actions" }[] = [
      { key: "new-lead", label: newLeadLabel, icon: "person_add", run: onNewLead, group: "actions" },
      ...leaves.map((l) => ({ key: l.key, label: l.label, icon: l.icon, meta: l.parent, run: () => onPick(l), group: "screens" as const })),
    ];
    return needle ? items.filter((x) => norm(`${x.label} ${x.meta ?? ""}`).includes(needle)) : items;
  }, [q, leaves, onPick, onNewLead, newLeadLabel]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(results.length - 1, x + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    if (e.key === "Enter" && results[i]) { e.preventDefault(); results[i].run(); }
  }
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-tp-forest-950/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={p.search} className="tp-pop relative w-full max-w-xl overflow-hidden rounded-xl border border-tp-line bg-tp-surface shadow-tp-overlay">
        <div className="flex items-center gap-2 border-b border-tp-line px-4">
          <Icon name="search" className="text-[20px] text-tp-ink-3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={onKey}
            placeholder={p.search}
            role="combobox"
            aria-expanded="true"
            aria-controls="tp-palette-list"
            aria-activedescendant={results[i] ? `tp-pal-${results[i].key}` : undefined}
            className="h-12 flex-1 bg-transparent text-sm text-tp-ink outline-none placeholder:text-tp-ink-3"
          />
          <kbd className="rounded border border-tp-line px-1.5 text-[11px] text-tp-ink-3">Esc</kbd>
        </div>
        <ul id="tp-palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-tp-ink-3">{fill(p.searchEmpty, { q })}</li>}
          {results.map((r, idx) => {
            const head = r.group !== lastGroup ? (lastGroup = r.group) : null;
            return (
              <li key={r.key} role="presentation">
                {head && <p className="px-3 pb-1 pt-2 text-xs font-medium text-tp-ink-3">{head === "actions" ? p.actions : p.screens}</p>}
                <div
                  id={`tp-pal-${r.key}`}
                  role="option"
                  aria-selected={idx === i}
                  onMouseEnter={() => setI(idx)}
                  onClick={r.run}
                  className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm ${idx === i ? "bg-tp-mint-50 text-tp-ink" : "text-tp-ink-2"}`}
                >
                  <Icon name={r.icon} className={`text-[18px] ${idx === i ? "text-tp-forest-700" : "text-tp-ink-3"}`} />
                  <span className="flex-1 truncate">{r.label}</span>
                  {r.meta && <span className="text-xs text-tp-ink-3">{r.meta}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-tp-line bg-tp-paper px-4 py-2 text-[11px] text-tp-ink-3">{p.searchHint}</p>
      </div>
    </div>
  );
}

// ===== حوار «ليد جديد» — تحقّقٌ حقيقي، وحفظٌ لا يقع =====

function NewLeadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale, t } = useI18n();
  const p = previewCopy(locale).newLead;
  const toast = useToast();
  const [v, setV] = useState({ name: "", phone: "", project: "", source: "", notes: "" });
  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) { setV({ name: "", phone: "", project: "", source: "", notes: "" }); setTried(false); } }, [open]);

  const errors = {
    name: !v.name.trim() ? p.required : null,
    phone: !v.phone.trim() ? p.required : /^07\d{9}$/.test(v.phone.replace(/\s/g, "")) ? null : p.phoneInvalid,
    project: !v.project ? p.required : null,
  };
  const show = (k: keyof typeof errors) => (tried ? errors[k] : null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    onClose();
    toast({ tone: "info", message: p.notSaved });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={p.title}
      description={p.hint}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" type="submit" form="tp-new-lead" icon="person_add">{p.submit}</Button>
        </>
      }
    >
      <form id="tp-new-lead" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label={p.name} error={show("name")} className="sm:col-span-2">
          {(a) => <input {...a} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={INPUT} autoComplete="off" />}
        </Field>
        <Field label={p.phone} hint={p.phoneHint} error={show("phone")}>
          {(a) => <input {...a} dir="ltr" inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} className={`${INPUT} text-start`} placeholder="07XX XXX XXXX" />}
        </Field>
        <Field label={p.project} error={show("project")}>
          {(a) => (
            <Select {...a} value={v.project} onChange={(x) => setV({ ...v, project: x })} className="w-full">
              <option value="">{p.pick}</option>
              {MOCK_PROJECTS.map((x) => <option key={x.id} value={x.id}>{x.name[locale]}</option>)}
            </Select>
          )}
        </Field>
        <Field label={p.source} className="sm:col-span-2">
          {(a) => (
            <Select {...a} value={v.source} onChange={(x) => setV({ ...v, source: x })} className="w-full">
              <option value="">{p.pick}</option>
              {MOCK_SOURCES.map((x) => <option key={x.id} value={x.id}>{x.name[locale]}</option>)}
            </Select>
          )}
        </Field>
        <Field label={p.notes} className="sm:col-span-2">
          {(a) => <textarea {...a} rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} className={`${INPUT} h-auto py-2`} />}
        </Field>
      </form>
    </Dialog>
  );
}
