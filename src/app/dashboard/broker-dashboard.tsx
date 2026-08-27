import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  bucketLeads,
  companyMoney,
  getBrokerCommissions,
  getBrokerPayments,
  getMyBrokerCompany,
  paidByCommission,
} from "@/lib/brokers";
import {
  Client,
  PIPELINE_STAGE_COLORS,
  formatPrice,
  leadDaysLeft,
  leadDeadlineColor,
  leadDeadlineLabel,
} from "@/lib/types";

// ============================================================
// لوحة الشركة الوسيطة.
//
// سؤالها الأول ليس «كم ليداً عندنا» بل **«أي ليد سأخسره غداً»** —
// فالمهل المتبقية هي أول ما يُعرض، ثم المال.
// ============================================================
export default async function BrokerDashboard() {
  const supabase = await createClient();

  const [company, { data: leadRows }, commissions, payments] = await Promise.all([
    getMyBrokerCompany(),
    supabase
      .from("clients")
      .select("*, projects(name)")
      .order("broker_deadline", { ascending: true, nullsFirst: false }),
    getBrokerCommissions(),
    getBrokerPayments(),
  ]);

  const leads = (leadRows ?? []) as Client[];
  const buckets = bucketLeads(leads);
  const money = companyMoney(commissions, paidByCommission(payments));

  const urgent = [...buckets.expired, ...buckets.urgent];

  const now = new Date();
  const greeting = now.getHours() < 12 ? "صباح الخير" : "مساء الخير";
  const dateLabel = now.toLocaleDateString("ar", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const kpis = [
    {
      icon: "hourglass_bottom",
      label: "مهل توشك على الانتهاء",
      value: String(urgent.length),
      href: "/dashboard/broker/leads",
      accent: urgent.length ? "border-s-red-500" : "border-s-emerald-500",
      iconColor: urgent.length ? "text-red-700 bg-red-50" : "text-emerald-700 bg-emerald-50",
    },
    {
      icon: "groups",
      label: "ليداتنا الفعّالة",
      value: String(buckets.active.length + buckets.urgent.length + buckets.expired.length),
      href: "/dashboard/broker/leads",
      accent: "border-s-blue-500",
      iconColor: "text-blue-700 bg-blue-50",
    },
    {
      icon: "handshake",
      label: "صفقات مغلقة",
      value: String(money.deals),
      href: "/dashboard/broker/commissions",
      accent: "border-s-brand-600",
      iconColor: "text-brand-700 bg-brand-50",
    },
    {
      icon: "payments",
      label: "الباقي لنا",
      value: formatPrice(money.remaining),
      href: "/dashboard/broker/commissions",
      accent: money.remaining ? "border-s-amber-500" : "border-s-emerald-500",
      iconColor: money.remaining ? "text-amber-700 bg-amber-50" : "text-emerald-700 bg-emerald-50",
    },
  ];

  return (
    <main className="p-6 lg:p-8">
      <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-gray-400">
            {dateLabel}
          </p>
          <h1 className="text-3xl font-bold text-brand-900">{greeting} 👋</h1>
          <p className="mt-1 text-gray-500">
            {company?.name ?? "شركة وسيطة"} — لكل ليد ٣٠ يوماً، ولكل بيع عمولة{" "}
            {company?.commission_rate ?? 0}٪.
          </p>
        </div>
        <Link
          href="/dashboard/broker/leads/new"
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + ليد جديد
        </Link>
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

      {/* المهل الحرجة */}
      <section className="mb-6">
        <div className="glass-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-lg font-bold text-brand-900">
              ليدات تحتاج إغلاقاً عاجلاً
            </h4>
            <Link
              href="/dashboard/broker/leads"
              className="text-sm font-bold text-brand-700 hover:underline"
            >
              كل ليداتنا
            </Link>
          </div>

          {urgent.length === 0 ? (
            <p className="text-sm text-emerald-700">
              لا مهل حرجة اليوم — كل الليدات ضمن وقتها.
            </p>
          ) : (
            <div className="space-y-2">
              {urgent.slice(0, 8).map((l) => {
                const days = leadDaysLeft(l.broker_deadline);
                return (
                  <Link
                    key={l.id}
                    href={`/dashboard/broker/leads/${l.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3 transition hover:bg-gray-100"
                  >
                    <div className="min-w-0">
                      <b className="text-gray-800">{l.name}</b>
                      <span className="ms-2 text-xs text-gray-500">
                        {l.projects?.name ?? ""}
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
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* آخر العمولات */}
      <section>
        <div className="glass-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-lg font-bold text-brand-900">آخر العمولات</h4>
            <Link
              href="/dashboard/broker/commissions"
              className="text-sm font-bold text-brand-700 hover:underline"
            >
              استحقاقاتنا كاملة
            </Link>
          </div>
          {commissions.length === 0 ? (
            <p className="text-sm text-gray-400">
              لا عمولات بعد — تُسجَّل تلقائياً عند إتمام أول بيع.
            </p>
          ) : (
            <div className="space-y-2">
              {commissions.slice(0, 5).map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3"
                >
                  <div>
                    <b className="text-gray-800">{c.clients?.name ?? "عميل"}</b>
                    <span className="ms-2 text-xs text-gray-400" dir="ltr">
                      {c.earned_at}
                    </span>
                  </div>
                  <span className="font-bold text-brand-800" dir="ltr">
                    {formatPrice(Number(c.amount))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
