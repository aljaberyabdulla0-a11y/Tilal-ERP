import Link from "next/link";
import { getUserRole } from "@/lib/auth";

// شريط تبويبات CRM — يظهر أعلى أقسام العملاء والوحدات والحجوزات.
// تبويب «التقارير» للإدارة فقط.
//
// مدير المتابعة يرى العملاء وسجلّ التواصل فقط: الوحدات والحجوزات
// خارج نطاقه في القاعدة (sql/040)، فلا نعرض له تبويباً يفتح شاشة
// فارغة.
export default async function CrmTabs({ active }: { active: string }) {
  const role = await getUserRole();
  const admin = role === "admin";
  const followup = role === "followup_manager";

  const tabs = [
    { key: "clients", label: "العملاء", href: "/dashboard/clients" },
    { key: "activities", label: "سجلّ التواصل", href: "/dashboard/clients/activities" },
    ...(admin
      ? [{ key: "reports", label: "التقارير", href: "/dashboard/crm/reports" }]
      : []),
    ...(followup
      ? []
      : [
          { key: "units", label: "الوحدات العقارية", href: "/dashboard/units" },
          { key: "reservations", label: "الحجوزات", href: "/dashboard/reservations" },
        ]),
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
