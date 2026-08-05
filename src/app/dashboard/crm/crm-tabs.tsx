import Link from "next/link";

// شريط تبويبات CRM — يظهر أعلى أقسام العملاء والوحدات والحجوزات
const TABS = [
  { key: "clients", label: "العملاء", href: "/dashboard/clients" },
  { key: "activities", label: "سجلّ التواصل", href: "/dashboard/clients/activities" },
  { key: "units", label: "الوحدات العقارية", href: "/dashboard/units" },
  { key: "reservations", label: "الحجوزات", href: "/dashboard/reservations" },
];

export default function CrmTabs({ active }: { active: string }) {
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
