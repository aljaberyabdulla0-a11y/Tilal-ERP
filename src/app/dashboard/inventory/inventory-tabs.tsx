import Link from "next/link";

// شريط تبويبات المخزون — يظهر أعلى كل شاشات القسم
export default function InventoryTabs({ active }: { active: string }) {
  const tabs = [
    { key: "items", label: "المواد", href: "/dashboard/inventory" },
    { key: "moves", label: "حركة المخزون", href: "/dashboard/inventory/moves" },
    { key: "suppliers", label: "الموردون", href: "/dashboard/inventory/suppliers" },
    { key: "reports", label: "التقارير", href: "/dashboard/inventory/reports" },
  ];

  return (
    <div className="border-b bg-white px-6">
      <nav className="flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={
              active === t.key
                ? "-mb-px whitespace-nowrap border-b-2 border-brand-600 px-4 py-3 font-semibold text-brand-600"
                : "whitespace-nowrap px-4 py-3 text-gray-500 transition hover:text-brand-600"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
