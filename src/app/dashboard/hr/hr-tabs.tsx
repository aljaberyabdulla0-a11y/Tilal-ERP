import Link from "next/link";

// شريط تبويبات HR — يظهر تبويب "الإدارة" للمدير فقط، و"بوابة الموظف" للجميع
export default function HrTabs({
  active,
  isAdmin,
}: {
  active: string;
  isAdmin: boolean;
}) {
  const tabs = [
    ...(isAdmin
      ? [{ key: "admin", label: "إدارة الموارد البشرية", href: "/dashboard/hr" }]
      : []),
    { key: "portal", label: "بوابة الموظف", href: "/dashboard/me" },
  ];

  // إن كان تبويباً واحداً فقط (موظف عادي) لا داعي لعرض الشريط
  if (tabs.length < 2) return null;

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
