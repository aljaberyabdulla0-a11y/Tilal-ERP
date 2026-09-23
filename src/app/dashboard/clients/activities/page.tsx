import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import {
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  SYSTEM_ACTIVITY_TYPES,
  ClientActivity,
  isSystemActivity,
} from "@/lib/types";
import { baghdadDate } from "@/lib/time";
import CrmTabs from "../../crm/crm-tabs";
import ActivityTimeline from "@/components/activity-timeline";
import Pager from "@/components/pager";

// ⚠️ كان الحدّ ٢٠٠ حدثاً بلا ترقيم: من أراد ما قبلها لم يكن له سبيل،
//    و«(أحدث ٢٠٠)» تقول إن هناك مزيداً ولا تقول كيف يُبلَغ (§62).
const PAGE_SIZE = 50;

// عدد الأيام التي يغطيها كل خيار في فلتر الفترة
const PERIODS = [
  { key: "7", label: "آخر ٧ أيام" },
  { key: "30", label: "آخر ٣٠ يوم" },
  { key: "90", label: "آخر ٣ أشهر" },
  { key: "all", label: "كل الفترات" },
];

// ============================================================
// سجلّ التواصل العام — كل الأنشطة عبر العملاء مع فلاتر.
// حماية الصفوف تضمن أن الموظف يرى أنشطة عملائه فقط.
// ============================================================
export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: { type?: string; outcome?: string; period?: string; page?: string };
}) {
  const supabase = await createClient();
  const admin = await isAdmin();

  const type = searchParams.type ?? "";
  const outcome = searchParams.outcome ?? "";
  const period = searchParams.period ?? "30";

  const page = Math.max(1, Number(searchParams.page) || 1);

  let query = supabase
    .from("client_activities")
    .select("*, clients(name, phone, stage)", { count: "exact" })
    .order("occurred_at", { ascending: false });

  if (type) query = query.eq("activity_type", type);
  if (outcome) query = query.eq("outcome", outcome);
  if (period !== "all") {
    const days = Number(period) || 30;
    const from = new Date(Date.now() - days * 86400000).toISOString();
    query = query.gte("occurred_at", from);
  }

  const { data, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const activities = (data ?? []) as ClientActivity[];
  const total = count ?? activities.length;

  // المُرشِّحات تُحمَل مع التنقّل فلا يعود المتصفِّح إلى البداية
  const pagerParams: Record<string, string> = {};
  if (type) pagerParams.type = type;
  if (outcome) pagerParams.outcome = outcome;
  if (period !== "30") pagerParams.period = period;

  // مؤشرات سريعة
  const today = baghdadDate();
  const realOnly = activities.filter(
    (a) => !isSystemActivity(a.activity_type)
  );
  const todayCount = realOnly.filter(
    (a) => baghdadDate(a.occurred_at) === today
  ).length;
  const noAnswer = realOnly.filter((a) => a.outcome === "لم يرد").length;
  const interested = realOnly.filter(
    (a) => a.outcome === "مهتم" || a.outcome === "تم الاتفاق"
  ).length;
  const clientsTouched = new Set(realOnly.map((a) => a.client_id)).size;

  // رابط يحافظ على بقيّة الفلاتر
  const linkWith = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ type, outcome, period, ...patch });
    for (const [k, v] of Array.from(p.entries())) if (!v) p.delete(k);
    return `/dashboard/clients/activities?${p.toString()}`;
  };

  const chip = (activeState: boolean) =>
    activeState
      ? "rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-medium text-white"
      : "rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100";

  const kpi = "rounded-2xl border bg-white p-5 shadow-sm";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">سجلّ التواصل</h1>
        </div>
        <Link
          href="/dashboard/clients"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
        >
          العملاء
        </Link>
      </header>

      <CrmTabs active="activities" />

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className={kpi}>
            <span className="text-sm text-gray-500">تواصل اليوم</span>
            <p className="mt-1 text-2xl font-bold text-brand-700">{todayCount}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">عملاء تم التواصل معهم</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{clientsTouched}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">مهتم / تم الاتفاق</span>
            <p className="mt-1 text-2xl font-bold text-green-700">{interested}</p>
          </div>
          <div className={kpi}>
            <span className="text-sm text-gray-500">لم يرد</span>
            <p className="mt-1 text-2xl font-bold text-amber-600">{noAnswer}</p>
          </div>
        </div>

        {/* الفلاتر */}
        <div className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="me-1 text-xs font-medium text-gray-500">الفترة</span>
            {PERIODS.map((p) => (
              <Link key={p.key} href={linkWith({ period: p.key })} className={chip(period === p.key)}>
                {p.label}
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="me-1 text-xs font-medium text-gray-500">النوع</span>
            <Link href={linkWith({ type: "" })} className={chip(!type)}>
              الكل
            </Link>
            {[...ACTIVITY_TYPES, ...SYSTEM_ACTIVITY_TYPES].map((t) => (
              <Link key={t.key} href={linkWith({ type: t.key })} className={chip(type === t.key)}>
                {t.key}
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="me-1 text-xs font-medium text-gray-500">النتيجة</span>
            <Link href={linkWith({ outcome: "" })} className={chip(!outcome)}>
              الكل
            </Link>
            {ACTIVITY_OUTCOMES.map((o) => (
              <Link key={o} href={linkWith({ outcome: o })} className={chip(outcome === o)}>
                {o}
              </Link>
            ))}
          </div>
        </div>

        <ActivityTimeline activities={activities} showClient canManage={admin} />

        <Pager
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          basePath="/dashboard/clients/activities"
          params={pagerParams}
          unit="حدثاً"
        />
      </section>
    </main>
  );
}
