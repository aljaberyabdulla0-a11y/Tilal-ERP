"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// ============================================================
// تنقّل القسم بطبقتين: المجموعة ثم شاشاتها.
//
// قسمٌ بعشرين شاشة لا يُعرض شريطاً واحداً — يُقرأ بالبحث لا بالنظر
// (نفس علّة القائمة الجانبية القديمة). فالمجموعات تسع، وتحتها
// شاشات المجموعة المفتوحة وحدها. وعلى الجوال يمرّر الشريطان أفقياً.
// ============================================================
type Item = { href: string; label: string };
type Group = { key: string; label: string; icon: string; items: Item[] };

const B = "/dashboard/marketing";

const GROUPS: Group[] = [
  { key: "home", label: "اللوحة", icon: "dashboard", items: [
    { href: B, label: "الرئيسية" },
    { href: `${B}/executive`, label: "التنفيذية" },
    { href: `${B}/search`, label: "بحث" },
  ] },
  { key: "plan", label: "التخطيط", icon: "flag", items: [
    { href: `${B}/plans`, label: "الاستراتيجية والخطط" },
    { href: `${B}/campaigns`, label: "الحملات" },
    { href: `${B}/calendar`, label: "التقويم" },
    { href: `${B}/tasks`, label: "المهامّ" },
    { href: `${B}/approvals`, label: "الموافقات" },
  ] },
  { key: "digital", label: "الرقمي", icon: "ads_click", items: [
    { href: `${B}/ads`, label: "الإعلانات المدفوعة" },
    { href: `${B}/content`, label: "المحتوى والسوشيال" },
    { href: `${B}/assets`, label: "مكتبة الأصول" },
    { href: `${B}/influencers`, label: "المؤثرون" },
  ] },
  { key: "offline", label: "الميداني", icon: "storefront", items: [
    { href: `${B}/offline`, label: "الأنشطة والفعاليات والمعارض" },
  ] },
  { key: "tracking", label: "التتبّع", icon: "qr_code_2", items: [
    { href: `${B}/tracking`, label: "الروابط و QR" },
    { href: `${B}/tracking?tab=pages`, label: "صفحات الهبوط" },
  ] },
  { key: "projects", label: "المشاريع", icon: "apartment", items: [
    { href: `${B}/projects`, label: "تسويق المشاريع" },
  ] },
  { key: "money", label: "المال", icon: "payments", items: [
    { href: `${B}/budget`, label: "الميزانيات" },
    { href: `${B}/expenses`, label: "المصروفات" },
    { href: `${B}/vendors`, label: "الموردون" },
    { href: `${B}/procurement`, label: "المشتريات والمواد" },
  ] },
  { key: "analytics", label: "التحليل", icon: "monitoring", items: [
    { href: `${B}/analytics`, label: "التقارير والإسناد" },
    { href: `${B}/followup`, label: "متابعة الليدات" },
    { href: `${B}/quality`, label: "جودة البيانات" },
  ] },
  { key: "ops", label: "الأتمتة", icon: "bolt", items: [
    { href: `${B}/automation`, label: "التنبيهات والقواعد" },
    { href: `${B}/integrations`, label: "التكاملات" },
    { href: `${B}/copilot`, label: "المساعد الذكي" },
    { href: `${B}/team`, label: "الفريق والإعدادات" },
  ] },
];

function matches(pathname: string, href: string): boolean {
  const path = href.split("?")[0];
  return path === B ? pathname === B : pathname === path || pathname.startsWith(`${path}/`);
}

export default function MktNav({ accountantOnly, accountantPaths }: { accountantOnly: boolean; accountantPaths: string[] }) {
  const pathname = usePathname();
  const groups = accountantOnly
    ? GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => accountantPaths.includes(i.href)) })).filter((g) => g.items.length)
    : GROUPS;
  const active = groups.find((g) => g.items.some((i) => matches(pathname, i.href))) ?? groups[0];

  return (
    <div className="border-b bg-white print:hidden">
      <nav className="flex gap-1 overflow-x-auto px-4 sm:px-6">
        {groups.map((g) => (
          <Link
            key={g.key}
            href={g.items[0].href}
            className={
              g.key === active.key
                ? "-mb-px flex items-center gap-1 whitespace-nowrap border-b-2 border-brand-600 px-3 py-3 text-sm font-semibold text-brand-600"
                : "flex items-center gap-1 whitespace-nowrap px-3 py-3 text-sm text-gray-500 hover:text-brand-600"
            }
          >
            <span className="material-symbols-outlined text-[18px]">{g.icon}</span>
            {g.label}
          </Link>
        ))}
      </nav>
      {active.items.length > 1 && (
        <nav className="flex gap-1 overflow-x-auto bg-gray-50 px-4 py-1.5 sm:px-6">
          {active.items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={
                matches(pathname, i.href) && !i.href.includes("?")
                  ? "whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm"
                  : "whitespace-nowrap rounded-full px-3 py-1 text-xs text-gray-600 hover:bg-white"
              }
            >
              {i.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
