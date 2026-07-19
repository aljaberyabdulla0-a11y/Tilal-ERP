import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { formatPrice } from "@/lib/types";
import EmployeeDashboard from "./employee-dashboard";

type RecentReservation = {
  id: string;
  created_at: string;
  status: string;
  clients: { name: string } | null;
  units: { project: string; unit_code: string | null } | null;
};

// لوحة التحكم التنفيذية — تصميم Stitch "Emerald Executive" ببيانات حقيقية
export default async function DashboardPage() {
  const admin = await isAdmin();

  // الموظف يرى لوحته الشخصية بدل اللوحة التنفيذية العامة
  if (!admin) return <EmployeeDashboard />;

  const supabase = await createClient();

  const [clientsRes, unitsRes, reservationsRes, paymentsRes, recentRes] =
    await Promise.all([
      supabase.from("clients").select("*", { count: "exact", head: true }),
      supabase.from("units").select("status, price"),
      supabase.from("reservations").select("status"),
      supabase.from("payments").select("amount, payment_date"),
      supabase
        .from("reservations")
        .select("id, created_at, status, clients(name), units(project, unit_code)")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const clientsCount = clientsRes.count ?? 0;
  const units = (unitsRes.data ?? []) as { status: string; price: number | null }[];
  const unitsAvailable = units.filter((u) => u.status === "متاحة").length;
  const unitsSold = units.filter((u) => u.status === "مباعة").length;
  const totalSales = units
    .filter((u) => u.status === "مباعة")
    .reduce((s, u) => s + (u.price ?? 0), 0);

  const reservations = (reservationsRes.data ?? []) as { status: string }[];
  const reservationsCount = reservations.length;
  const completedSales = reservations.filter((r) => r.status === "بيع مكتمل").length;

  const payments = (paymentsRes.data ?? []) as {
    amount: number;
    payment_date: string | null;
  }[];
  const totalRevenue = payments.reduce((s, p) => s + (p.amount ?? 0), 0);

  // إيرادات آخر 6 أشهر
  const now = new Date();
  const months: { key: string; label: string; total: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("ar", { month: "short" }),
      total: 0,
    });
  }
  payments.forEach((p) => {
    if (!p.payment_date) return;
    const m = months.find((x) => x.key === p.payment_date!.slice(0, 7));
    if (m) m.total += p.amount ?? 0;
  });
  const maxMonth = Math.max(1, ...months.map((m) => m.total));

  const recent = (recentRes.data ?? []) as unknown as RecentReservation[];

  const greeting = now.getHours() < 12 ? "صباح الخير" : "مساء الخير";
  const dateLabel = now.toLocaleDateString("ar", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // مسار المبيعات (قِمع)
  const pipeline = [
    { label: "العملاء", value: clientsCount, color: "bg-brand-700", text: "text-white" },
    { label: "الحجوزات", value: reservationsCount, color: "bg-brand-600", text: "text-white" },
    { label: "الوحدات المباعة", value: unitsSold, color: "bg-brand-500", text: "text-white" },
    { label: "مبيعات مكتملة", value: completedSales, color: "bg-brand-100", text: "text-brand-700" },
  ];
  const pipeMax = Math.max(1, ...pipeline.map((p) => p.value));

  const kpis = [
    { icon: "payments", label: "إجمالي المبيعات", value: formatPrice(totalSales), accent: "border-r-brand-600", iconColor: "text-brand-700 bg-brand-50" },
    { icon: "trending_up", label: "الإيرادات المحصّلة", value: formatPrice(totalRevenue), accent: "border-r-emerald-500", iconColor: "text-emerald-700 bg-emerald-50" },
    { icon: "apartment", label: "الوحدات المتاحة", value: String(unitsAvailable), accent: "border-r-blue-500", iconColor: "text-blue-700 bg-blue-50" },
    { icon: "check_circle", label: "الوحدات المباعة", value: String(unitsSold), accent: "border-r-brand-500", iconColor: "text-brand-700 bg-brand-50" },
    { icon: "groups", label: "العملاء", value: String(clientsCount), accent: "border-r-amber-500", iconColor: "text-amber-700 bg-amber-50" },
  ];

  return (
    <main className="p-6 lg:p-8">
      {/* التحية */}
      <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-gray-400">
            {dateLabel}
          </p>
          <h1 className="text-3xl font-bold text-brand-900">{greeting} 👋</h1>
          <p className="mt-1 text-gray-500">نظرة سريعة على أداء شركتك العقارية اليوم.</p>
        </div>
      </section>

      {/* بطاقات المؤشرات KPI */}
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className={`glass-card border-r-4 ${k.accent} p-5`}>
            <span
              className={`material-symbols-outlined rounded-lg p-2 ${k.iconColor}`}
            >
              {k.icon}
            </span>
            <p className="mt-3 text-xs font-bold uppercase text-gray-400">{k.label}</p>
            <h3 className="mt-1 text-2xl font-bold text-brand-900" dir="ltr">
              {k.value}
            </h3>
          </div>
        ))}
      </section>

      {/* المخطط + مسار المبيعات */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* مخطط الإيرادات الشهرية */}
        <div className="glass-card p-6 lg:col-span-2">
          <div className="mb-6">
            <h4 className="text-lg font-bold text-brand-900">الإيرادات الشهرية</h4>
            <p className="text-sm text-gray-400">المبالغ المحصّلة خلال آخر 6 أشهر</p>
          </div>
          <div className="flex h-56 items-end gap-3 border-b border-gray-200/70 pb-6">
            {months.map((m) => (
              <div key={m.key} className="group relative flex flex-1 flex-col items-center justify-end">
                <span className="mb-1 text-[10px] font-bold text-gray-400 opacity-0 transition group-hover:opacity-100" dir="ltr">
                  {formatPrice(m.total)}
                </span>
                <div
                  className="w-full rounded-t-lg bg-brand-600 shadow-lg shadow-brand-600/20 transition-all group-hover:bg-brand-700"
                  style={{ height: `${Math.max(4, (m.total / maxMonth) * 100)}%` }}
                />
                <span className="absolute -bottom-6 text-[11px] font-bold uppercase text-gray-400">
                  {m.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* مسار المبيعات */}
        <div className="glass-card p-6">
          <h4 className="mb-6 text-lg font-bold text-brand-900">مسار المبيعات</h4>
          <div className="space-y-4">
            {pipeline.map((p, i) => (
              <div key={p.label} style={{ paddingInlineStart: `${i * 12}px` }}>
                <div className="mb-1 flex justify-between text-[11px] font-bold uppercase text-gray-400">
                  <span>{p.label}</span>
                  <span dir="ltr">{p.value}</span>
                </div>
                <div
                  className={`flex h-8 items-center rounded-lg px-4 ${p.color}`}
                  style={{ width: `${Math.max(28, (p.value / pipeMax) * 100)}%` }}
                >
                  <span className={`text-[10px] font-bold ${p.text}`}>{p.value}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* آخر النشاطات + روابط سريعة */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* آخر النشاطات */}
        <div className="glass-card p-6 lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <h4 className="text-lg font-bold text-brand-900">آخر النشاطات</h4>
            <Link href="/dashboard/reservations" className="text-sm font-bold text-brand-700 hover:underline">
              عرض الكل
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد نشاطات بعد.</p>
          ) : (
            <div className="relative space-y-6">
              <div className="absolute bottom-4 right-[11px] top-2 w-[2px] bg-gray-200/70" />
              {recent.map((r) => (
                <div key={r.id} className="relative pr-10">
                  <div className="absolute right-0 top-1 flex h-6 w-6 items-center justify-center rounded-full border-4 border-white bg-brand-600 shadow-sm">
                    <span className="material-symbols-outlined text-[12px] text-white">key</span>
                  </div>
                  <h5 className="font-bold text-gray-800">
                    {r.clients?.name ?? "عميل"} — حجز{" "}
                    {r.units ? `${r.units.project}${r.units.unit_code ? " " + r.units.unit_code : ""}` : "وحدة"}
                  </h5>
                  <p className="text-sm text-gray-500">الحالة: {r.status}</p>
                  <span className="mt-1 block text-[10px] font-bold uppercase text-gray-400" dir="ltr">
                    {new Date(r.created_at).toLocaleDateString("ar")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* روابط سريعة */}
        <div className="glass-card p-6">
          <h4 className="mb-4 text-lg font-bold text-brand-900">وصول سريع</h4>
          <div className="space-y-2">
            {[
              { href: "/dashboard/crm", label: "إدارة العملاء والعقارات", icon: "groups" },
              // الفواتير للمدير فقط
              ...(admin
                ? [{ href: "/dashboard/invoices/new", label: "إنشاء فاتورة جديدة", icon: "receipt_long" }]
                : []),
              { href: "/dashboard/reservations/new", label: "تسجيل حجز جديد", icon: "key" },
              { href: "/dashboard/hr", label: "الموارد البشرية", icon: "badge" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex items-center gap-3 rounded-xl bg-gray-50 p-3 text-gray-700 transition hover:bg-brand-50 hover:text-brand-700"
              >
                <span className="material-symbols-outlined text-brand-600">{l.icon}</span>
                <span className="font-medium">{l.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
