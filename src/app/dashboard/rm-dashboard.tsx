import Link from "next/link";
import {
  bucketLeads,
  companyMoney,
  getBrokerCommissions,
  getBrokerCompanies,
  getBrokerLeads,
  getBrokerPayments,
  getBrokerProjects,
  paidByCommission,
} from "@/lib/brokers";
import {
  PIPELINE_STAGE_COLORS,
  formatPrice,
  leadDaysLeft,
  leadDeadlineColor,
  leadDeadlineLabel,
  sinceColor,
  sinceLabel,
} from "@/lib/types";
import TodayTasks from "@/components/today-tasks";

// ============================================================
// لوحة مدير العلاقات (RM).
//
// نطاقه: الشركات المُسنَدة إليه في مشاريعه — تُرجعها القاعدة وحدها
// (sql/043)، فلا شرط هنا. وما يهمّه أولاً: ليد يوشك أن يضيع من
// شركةٍ تحت مظلته، ثم شركة صامتة لا تتواصل مع ليداتها.
// ============================================================
export default async function RmDashboard() {
  const [companies, links, leads, commissions, payments] = await Promise.all([
    getBrokerCompanies(),
    getBrokerProjects(),
    getBrokerLeads(),
    getBrokerCommissions(),
    getBrokerPayments(),
  ]);

  const buckets = bucketLeads(leads);
  const paid = paidByCommission(payments);
  const urgent = [...buckets.expired, ...buckets.urgent];

  // ليدات لم يُسجَّل عليها تواصل إطلاقاً — أوضح مؤشر على شركة متكاسلة
  const silent = leads.filter((l) => !l.last_contact_at && l.stage !== "بيع");

  const projectNames = Array.from(
    new Set(links.map((l) => l.projects?.name).filter(Boolean))
  ) as string[];

  const now = new Date();
  const greeting = now.getHours() < 12 ? "صباح الخير" : "مساء الخير";

  const kpis = [
    {
      icon: "apartment",
      label: "شركات تحت مظلتي",
      value: String(companies.length),
      href: "/dashboard/brokers",
      accent: "border-s-brand-600",
      iconColor: "text-brand-700 bg-brand-50",
    },
    {
      icon: "hourglass_bottom",
      label: "مهل حرجة",
      value: String(urgent.length),
      href: "/dashboard/brokers/leads",
      accent: urgent.length ? "border-s-red-500" : "border-s-emerald-500",
      iconColor: urgent.length ? "text-red-700 bg-red-50" : "text-emerald-700 bg-emerald-50",
    },
    {
      icon: "phone_missed",
      label: "ليدات بلا تواصل",
      value: String(silent.length),
      href: "/dashboard/brokers/leads",
      accent: silent.length ? "border-s-amber-500" : "border-s-emerald-500",
      iconColor: silent.length ? "text-amber-700 bg-amber-50" : "text-emerald-700 bg-emerald-50",
    },
    {
      icon: "handshake",
      label: "صفقات مغلقة",
      value: String(buckets.closed.length),
      href: "/dashboard/brokers/commissions",
      accent: "border-s-emerald-500",
      iconColor: "text-emerald-700 bg-emerald-50",
    },
  ];

  return (
    <main className="p-6 lg:p-8">
      <section className="mb-6">
        <h1 className="text-3xl font-bold text-brand-900">{greeting} 👋</h1>
        <p className="mt-1 text-gray-500">
          {projectNames.length > 0
            ? `مدير علاقات في: ${projectNames.join(" · ")}`
            : "لم تُسنَد إليك شركات بعد — راجع الإدارة."}
        </p>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Link
            key={k.label}
            href={k.href}
            className={`glass-card border-s-4 ${k.accent} p-5 transition hover:shadow-md`}
          >
            <span className={`material-symbols-outlined rounded-lg p-2 ${k.iconColor}`}>
              {k.icon}
            </span>
            <p className="mt-3 text-xs font-bold uppercase text-gray-400">{k.label}</p>
            <h3 className="mt-1 text-2xl font-bold text-brand-900" dir="ltr">
              {k.value}
            </h3>
          </Link>
        ))}
      </section>

      {/* الشركات تحت مظلتي */}
      <section className="mb-6">
        <div className="glass-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-lg font-bold text-brand-900">الشركات تحت مظلتي</h4>
            <Link
              href="/dashboard/brokers"
              className="text-sm font-bold text-brand-700 hover:underline"
            >
              التفاصيل
            </Link>
          </div>

          {companies.length === 0 ? (
            <p className="text-sm text-gray-400">لا شركات مُسنَدة إليك بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-start text-sm">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">الشركة</th>
                    <th className="px-3 py-2 text-start font-medium">ليدات</th>
                    <th className="px-3 py-2 text-start font-medium">مهل حرجة</th>
                    <th className="px-3 py-2 text-start font-medium">بلا تواصل</th>
                    <th className="px-3 py-2 text-start font-medium">صفقات</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => {
                    const mine = leads.filter((l) => l.broker_company_id === c.id);
                    const b = bucketLeads(mine);
                    const money = companyMoney(
                      commissions.filter((x) => x.company_id === c.id),
                      paid
                    );
                    return (
                      <tr key={c.id} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <Link
                            href={`/dashboard/brokers/${c.id}`}
                            className="font-semibold text-brand-700 hover:underline"
                          >
                            {c.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{mine.length}</td>
                        <td className="px-3 py-2">
                          {b.expired.length + b.urgent.length > 0 ? (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                              {b.expired.length + b.urgent.length}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {mine.filter((l) => !l.last_contact_at && l.stage !== "بيع").length}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{money.deals}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* مهل حرجة */}
      <section className="mb-6">
        <div className="glass-card p-6">
          <h4 className="mb-4 text-lg font-bold text-brand-900">
            ليدات على وشك العودة إلى تلال
          </h4>
          {urgent.length === 0 ? (
            <p className="text-sm text-emerald-700">لا مهل حرجة اليوم.</p>
          ) : (
            <div className="space-y-2">
              {urgent.slice(0, 10).map((l) => {
                const days = leadDaysLeft(l.broker_deadline);
                return (
                  <div
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/dashboard/clients/${l.id}`}
                        className="font-semibold text-gray-800 hover:text-brand-700"
                      >
                        {l.name}
                      </Link>
                      <span className="ms-2 text-xs text-gray-500">
                        {l.broker_companies?.name ?? ""}
                      </span>
                      <span className={`ms-2 text-xs font-medium ${sinceColor(l.last_contact_at)}`}>
                        {sinceLabel(l.last_contact_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          PIPELINE_STAGE_COLORS[l.stage ?? "ليد"] ??
                          "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {l.stage ?? "ليد"}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${leadDeadlineColor(days)}`}
                      >
                        {leadDeadlineLabel(days)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section>
        <TodayTasks />
      </section>
    </main>
  );
}
