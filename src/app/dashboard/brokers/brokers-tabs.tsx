import Link from "next/link";

// شريط تبويبات الوساطة — للإدارة ومدير العلاقات ومشرف المشروع
export default function BrokersTabs({ active }: { active: string }) {
  const tabs = [
    { key: "requests", label: "طلبات الحجز", href: "/dashboard/brokers/requests" },
    { key: "companies", label: "الشركات", href: "/dashboard/brokers" },
    { key: "leads", label: "الليدات والمهل", href: "/dashboard/brokers/leads" },
    { key: "commissions", label: "تقرير العمولات", href: "/dashboard/brokers/commissions" },
    { key: "performance", label: "الأداء", href: "/dashboard/brokers/performance" },
    { key: "plans", label: "خطط العمولة", href: "/dashboard/brokers/plans" },
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
