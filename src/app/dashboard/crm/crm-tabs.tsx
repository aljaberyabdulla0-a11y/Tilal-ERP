import Link from "next/link";
import { getUserRole } from "@/lib/auth";

// شريط تبويبات CRM — يظهر أعلى أقسام العملاء والوحدات والحجوزات.
//
// مدير المتابعة يرى العملاء وسجلّ التواصل فقط: الوحدات والحجوزات
// خارج نطاقه في القاعدة (sql/040)، فلا نعرض له تبويباً يفتح شاشة
// فارغة.
export default async function CrmTabs({ active }: { active: string }) {
  const role = await getUserRole();
  const admin = role === "admin";
  const followup = role === "followup_manager";
  const supervisor = role === "supervisor";

  // «يومي» أولاً عمداً: الموظف يفتح الـCRM ليعمل لا ليتصفّح قوائم.
  //
  // ثلاث طبقات من التبويبات بحسب من يفتحها:
  //   الجميع        يومي · العملاء · الفرص · سجلّ التواصل
  //   من يدير       + نظرة · التوزيع · التقارير · التنبؤ
  //   المدير وحده   + الجودة (الدمج والحذف من صلاحيته في sql/077)
  //
  // لا نعرض تبويباً يفتح شاشة بلا صلاحية — الصفحة نفسها تُعيد
  // التوجيه، لكن الأفضل ألّا يظهر الباب أصلاً.
  const manages = admin || followup || supervisor;

  const tabs = [
    { key: "today", label: "يومي", href: "/dashboard/crm/today" },
    ...(manages ? [{ key: "overview", label: "نظرة", href: "/dashboard/crm/overview" }] : []),
    { key: "clients", label: "العملاء", href: "/dashboard/clients" },
    { key: "opportunities", label: "الفرص", href: "/dashboard/crm/opportunities" },
    { key: "activities", label: "سجلّ التواصل", href: "/dashboard/clients/activities" },
    ...(manages
      ? [
          { key: "distribution", label: "التوزيع", href: "/dashboard/crm/distribution" },
          { key: "reports", label: "التقارير", href: "/dashboard/crm/reports" },
          { key: "forecast", label: "التنبؤ", href: "/dashboard/crm/forecast" },
          { key: "campaigns", label: "الحملات", href: "/dashboard/crm/campaigns" },
        ]
      : []),
    ...(admin || followup
      ? [{ key: "data-quality", label: "الجودة", href: "/dashboard/crm/data-quality" }]
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
