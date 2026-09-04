import Link from "next/link";

// شريط تبويبات المحاسبة — البسيط أولاً، والمتقدّم في الآخر
const TABS = [
  { key: "home", label: "الملخص المالي", href: "/dashboard/accounting" },
  { key: "moves", label: "الحركات المالية", href: "/dashboard/accounting/moves" },
  { key: "debts", label: "الديون الخارجية", href: "/dashboard/accounting/debts" },
  { key: "partners", label: "الشركاء والتصفية", href: "/dashboard/accounting/partners" },
  { key: "periods", label: "الفترات المحاسبية", href: "/dashboard/accounting/periods" },
  { key: "advanced", label: "المحاسبة المتقدمة", href: "/dashboard/accounting/advanced" },
];

export default function AccTabs({ active }: { active: string }) {
  return (
    <div className="border-b bg-white px-6">
      <nav className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={
              active === t.key
                ? "-mb-px whitespace-nowrap border-b-2 border-brand-600 px-4 py-3 font-semibold text-brand-700"
                : "whitespace-nowrap px-4 py-3 text-gray-500 transition hover:text-brand-700"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
