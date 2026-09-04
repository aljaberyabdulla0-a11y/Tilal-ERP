import Link from "next/link";

// شريط تبويبات قسم الدوام
export default function AttendanceTabs({ active }: { active: string }) {
  const tabs = [
    { key: "today", label: "اليوم", href: "/dashboard/attendance" },
    { key: "monthly", label: "التقرير الشهري", href: "/dashboard/attendance/monthly" },
    { key: "rules", label: "قواعد الخصم", href: "/dashboard/attendance/rules" },
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
