import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Client, ClientActivity, toIntlPhone } from "@/lib/types";
import { baghdadDate } from "@/lib/time";
import {
  buildFunnel,
  buildFollowUps,
  buildKpis,
  buildNeglected,
  buildSources,
  buildTeam,
  buildTrend,
} from "@/lib/crm-reports";
import CrmTabs from "../crm-tabs";
import RunFollowupScan from "./run-scan";

// تدرّج لوني واحد للقمع (فاتح ← غامق كلّما تقدّمت المرحلة).
// اخترنا تدرّجاً واحداً لا ألواناً متعددة: أسماء المراحل مكتوبة بجانب
// كل شريط، فالهوية يحملها النص لا اللون — وهذا يبقى مقروءاً لمصابي
// عمى الألوان (الأزرق والبنفسجي مثلاً لا يتمايزان لديهم).
const FUNNEL_FILL = ["#6ee7b7", "#34d399", "#10b981", "#059669", "#047857"];

export default async function CrmReportsPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard/clients");

  const periodDays = Number(searchParams.days) || 30;
  const since = new Date(Date.now() - periodDays * 86400000).toISOString();
  const today = baghdadDate();

  const supabase = await createClient();
  const [{ data: cData }, { data: aData }, { data: unmatchedData }] = await Promise.all([
    supabase.from("clients").select("*").limit(5000),
    supabase
      .from("client_activities")
      .select("*")
      .gte("occurred_at", since)
      .limit(5000),
    // أسماء موظفي مبيعات بلا حساب مطابق (sql/032) — null إن لم يُشغَّل بعد
    supabase.rpc("unmatched_sales_employees"),
  ]);

  const unmatched = (unmatchedData ?? []) as {
    sales_employee: string;
    clients: number;
    due_followups: number;
  }[];

  const clients = (cData ?? []) as Client[];
  const activities = (aData ?? []) as ClientActivity[];

  const kpis = buildKpis(clients, activities, today);
  const { steps, entered, lost } = buildFunnel(clients);
  const { overdue, dueToday } = buildFollowUps(clients, today);
  const neglected = buildNeglected(clients, 14, today);
  const team = buildTeam(clients, activities, today);
  const sources = buildSources(clients);
  const trend = buildTrend(activities, 14, today);
  const trendMax = Math.max(1, ...trend.map((t) => t.count));

  const card = "rounded-2xl border bg-white p-5 shadow-sm";
  const periods = [
    { d: 7, label: "٧ أيام" },
    { d: 30, label: "٣٠ يوم" },
    { d: 90, label: "٣ أشهر" },
  ];

  // بطاقة رقم — ليست مخططاً لأن الرقم الواحد يُقرأ أسرع كرقم
  const Stat = ({
    label,
    value,
    hint,
    tone = "gray",
  }: {
    label: string;
    value: string | number;
    hint?: string;
    tone?: "gray" | "good" | "warn" | "bad";
  }) => {
    const tones = {
      gray: "text-gray-800",
      good: "text-green-700",
      warn: "text-amber-600",
      bad: "text-red-700",
    };
    return (
      <div className={card}>
        <span className="text-sm text-gray-500">{label}</span>
        <p className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
      </div>
    );
  };

  // صف عميل في لوحة العمل — الاسم والهاتف وأزرار التواصل المباشر
  const ActionRow = ({
    c,
    daysLate,
    stalled,
  }: {
    c: Client;
    daysLate: number;
    stalled?: boolean;
  }) => (
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-0 hover:bg-gray-50">
      <div className="min-w-0 flex-1">
        <Link
          href={`/dashboard/clients/${c.id}`}
          className="font-medium text-gray-800 hover:text-brand-600"
        >
          {c.name}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
          <span>{c.stage ?? "ليد"}</span>
          {c.sales_employee && <span>{c.sales_employee}</span>}
          {c.phone && (
            <span dir="ltr" className="text-gray-400">
              {c.phone}
            </span>
          )}
          {stalled && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
              بلا تحديث
            </span>
          )}
        </div>
      </div>

      <span
        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
          daysLate === 0
            ? "bg-blue-50 text-blue-700"
            : daysLate <= 3
            ? "bg-amber-50 text-amber-700"
            : "bg-red-50 text-red-700"
        }`}
      >
        {daysLate === 0 ? "موعده اليوم" : `متأخر ${daysLate} يوم`}
      </span>

      {c.phone && (
        <div className="flex gap-1.5">
          <a
            href={`tel:${toIntlPhone(c.phone)}`}
            title="اتصال"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-700"
          >
            <span className="material-symbols-outlined text-[18px]">call</span>
          </a>
          <a
            href={`https://wa.me/${toIntlPhone(c.phone).replace("+", "")}`}
            target="_blank"
            rel="noopener noreferrer"
            title="واتساب"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 text-white transition hover:bg-green-700"
          >
            <span className="material-symbols-outlined text-[18px]">chat</span>
          </a>
        </div>
      )}
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-600">
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-600">تقارير المبيعات</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {periods.map((p) => (
            <Link
              key={p.d}
              href={`/dashboard/crm/reports?days=${p.d}`}
              className={
                periodDays === p.d
                  ? "rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-medium text-white"
                  : "rounded-full border border-gray-300 px-3.5 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100"
              }
            >
              {p.label}
            </Link>
          ))}
          <RunFollowupScan />
        </div>
      </header>

      <CrmTabs active="reports" />

      <section className="space-y-6 p-6">
        {clients.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا يوجد عملاء بعد — التقارير تظهر بمجرّد إضافة أول عميل.
          </div>
        )}

        {/* ===== المؤشرات ===== */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-6">
          <Stat label="إجمالي العملاء" value={kpis.total} hint={`${kpis.newThisMonth} جديد هذا الشهر`} />
          <Stat label="صفقات مغلقة (بيع)" value={kpis.won} tone="good" hint={`${kpis.lost} فشل`} />
          <Stat
            label="معدّل الإغلاق"
            value={`${kpis.winRate}%`}
            tone={kpis.winRate >= 40 ? "good" : kpis.winRate >= 20 ? "warn" : "bad"}
            hint="من الصفقات المغلقة"
          />
          <Stat
            label="متابعات متأخرة"
            value={kpis.overdueFollowUps}
            tone={kpis.overdueFollowUps > 0 ? "bad" : "good"}
            hint={`${kpis.dueTodayFollowUps} موعدها اليوم`}
          />
          <Stat
            label="عملاء مهمَلون"
            value={kpis.neglected}
            tone={kpis.neglected > 0 ? "warn" : "good"}
            hint="بلا تواصل +١٤ يوم"
          />
          <Stat
            label="متوسط زمن الإغلاق"
            value={kpis.avgDaysToWin === null ? "—" : `${kpis.avgDaysToWin} يوم`}
            hint="من الإضافة حتى البيع"
          />
        </div>

        {/* ===== تحذير: عملاء لا يراهم أي موظف ===== */}
        {unmatched.length > 0 && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
            <h2 className="flex items-center gap-2 font-bold text-amber-900">
              <span className="material-symbols-outlined">person_alert</span>
              عملاء لا يراهم أي موظف ({unmatched.reduce((s, r) => s + r.clients, 0)})
            </h2>
            <p className="mt-1 text-sm text-amber-800">
              اسم «موظف المبيعات» المكتوب على هؤلاء العملاء لا يطابق أي حساب موظف،
              فلا تصل متابعاتهم إلا لك. الحل: افتح ملف الموظف واربطه بحساب دخول،
              أو صحّح اسم موظف المبيعات على العميل.
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {unmatched.map((r) => (
                <li
                  key={r.sales_employee}
                  className="rounded-full border border-amber-300 bg-white px-3 py-1 text-sm text-amber-900"
                >
                  {r.sales_employee} — {r.clients} عميل
                  {r.due_followups > 0 && (
                    <b className="text-red-700"> · {r.due_followups} متابعة مستحقة</b>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ===== لوحة عمل اليوم — أهم شاشة عملية ===== */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b bg-red-50 px-4 py-3">
              <h2 className="font-bold text-red-800">
                🔴 متابعات متأخرة ({overdue.length})
              </h2>
              <span className="text-xs text-red-700">اتصل بهم أولاً</span>
            </div>
            {overdue.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">
                ما في متابعة متأخرة — ممتاز.
              </p>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                {overdue.slice(0, 50).map((r) => (
                  <ActionRow
                    key={r.client.id}
                    c={r.client}
                    daysLate={r.daysLate}
                    stalled={r.stalled}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b bg-blue-50 px-4 py-3">
              <h2 className="font-bold text-blue-800">
                📅 متابعات اليوم ({dueToday.length})
              </h2>
              <span className="text-xs text-blue-700">{today}</span>
            </div>
            {dueToday.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">
                لا توجد متابعات مجدولة اليوم.
              </p>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                {dueToday.slice(0, 50).map((r) => (
                  <ActionRow key={r.client.id} c={r.client} daysLate={0} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ===== قمع المبيعات ===== */}
        <div className={card}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold text-gray-800">قمع المبيعات</h2>
            <span className="text-xs text-gray-500">
              دخل القمع {entered} عميل · خرج منه {lost} بفشل البيع
            </span>
          </div>
          <p className="mb-4 text-xs text-gray-400">
            كل شريط يعرض من وصل لهذه المرحلة أو تجاوزها — فتعرف أين تتوقّف الصفقات.
          </p>

          <div className="space-y-3">
            {steps.map((s, i) => (
              <div key={s.stage} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm text-gray-700">{s.stage}</span>

                <div className="h-6 min-w-0 flex-1 rounded-md bg-gray-100">
                  <div
                    className="h-6 rounded-md transition-all"
                    style={{
                      width: `${Math.max(s.reachedPercent, s.count > 0 ? 2 : 0)}%`,
                      backgroundColor: FUNNEL_FILL[i] ?? FUNNEL_FILL[FUNNEL_FILL.length - 1],
                    }}
                    title={`${s.stage}: ${s.count} عميل (${s.reachedPercent}% من الداخلين)`}
                  />
                </div>

                <span className="w-14 shrink-0 text-left text-sm font-bold text-gray-800" dir="ltr">
                  {s.count}
                </span>
                <span className="w-24 shrink-0 text-left text-xs text-gray-500" dir="ltr">
                  {s.stepConversion === null ? "—" : `↓ ${s.stepConversion}%`}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ===== نشاط التواصل ===== */}
        <div className={card}>
          <h2 className="font-bold text-gray-800">نشاط التواصل — آخر ١٤ يوم</h2>
          <p className="mb-4 text-xs text-gray-400">
            عدد مرات التواصل المسجّلة يومياً (بلا تغييرات المرحلة التلقائية).
          </p>

          <div className="flex h-40 items-end gap-1.5">
            {trend.map((t) => (
              <div key={t.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="text-[10px] font-medium text-gray-500">
                  {t.count > 0 ? t.count : ""}
                </span>
                <div
                  className="w-full rounded-t-md bg-brand-600"
                  style={{ height: `${Math.max((t.count / trendMax) * 100, t.count > 0 ? 4 : 1)}%` }}
                  title={`${t.date}: ${t.count} تواصل`}
                />
                <span className="text-[10px] text-gray-400" dir="ltr">
                  {t.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ===== أداء الفريق ===== */}
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-bold text-gray-800">أداء الفريق</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              التواصل محسوب خلال آخر {periodDays} يوم، والباقي إجمالي.
            </p>
          </div>

          {team.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-400">لا توجد بيانات بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-right text-sm">
                <thead className="border-b bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">الموظف</th>
                    <th className="px-4 py-3 font-medium">عملاؤه</th>
                    <th className="px-4 py-3 font-medium">مفتوح</th>
                    <th className="px-4 py-3 font-medium">بيع</th>
                    <th className="px-4 py-3 font-medium">فشل</th>
                    <th className="px-4 py-3 font-medium">معدّل الإغلاق</th>
                    <th className="px-4 py-3 font-medium">تواصل</th>
                    <th className="px-4 py-3 font-medium">مكالمات</th>
                    <th className="px-4 py-3 font-medium">لقاءات</th>
                    <th className="px-4 py-3 font-medium">متأخرة</th>
                    <th className="px-4 py-3 font-medium">بلا تواصل</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((t) => (
                    <tr key={t.name} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{t.name}</td>
                      <td className="px-4 py-3 text-gray-700">{t.clients}</td>
                      <td className="px-4 py-3 text-gray-700">{t.open}</td>
                      <td className="px-4 py-3 font-semibold text-green-700">{t.won}</td>
                      <td className="px-4 py-3 text-gray-500">{t.lost}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-14 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-brand-600"
                              style={{ width: `${Math.min(t.winRate, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-gray-700">
                            {t.winRate}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{t.activities}</td>
                      <td className="px-4 py-3 text-gray-500">{t.calls}</td>
                      <td className="px-4 py-3 text-gray-500">{t.meetings}</td>
                      <td className={`px-4 py-3 font-semibold ${t.overdue > 0 ? "text-red-700" : "text-gray-300"}`}>
                        {t.overdue || "—"}
                      </td>
                      <td className={`px-4 py-3 ${t.noContact > 0 ? "text-amber-600" : "text-gray-300"}`}>
                        {t.noContact || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* ===== المصادر ===== */}
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="font-bold text-gray-800">مصادر العملاء</h2>
              <p className="mt-0.5 text-xs text-gray-400">
                أي مصدر يجيب صفقات فعلاً — وجّه ميزانية التسويق نحوه.
              </p>
            </div>
            {sources.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">لا توجد بيانات.</p>
            ) : (
              <table className="w-full text-right text-sm">
                <thead className="border-b bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">المصدر</th>
                    <th className="px-4 py-3 font-medium">عملاء</th>
                    <th className="px-4 py-3 font-medium">بيع</th>
                    <th className="px-4 py-3 font-medium">معدّل الإغلاق</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.source} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800">{s.source}</td>
                      <td className="px-4 py-3 text-gray-700">{s.total}</td>
                      <td className="px-4 py-3 font-semibold text-green-700">{s.won}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-brand-600"
                              style={{ width: `${Math.min(s.winRate, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-600">{s.winRate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ===== المهمَلون ===== */}
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="font-bold text-gray-800">
                عملاء مهمَلون ({neglected.length})
              </h2>
              <p className="mt-0.5 text-xs text-gray-400">
                عملاء مفتوحون بلا تواصل منذ ١٤ يوماً فأكثر.
              </p>
            </div>
            {neglected.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">
                ما في عميل مهمَل — أحسنتم.
              </p>
            ) : (
              <div className="max-h-[400px] overflow-y-auto">
                {neglected.slice(0, 50).map(({ client: c, days }) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 border-b px-4 py-3 last:border-0 hover:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/dashboard/clients/${c.id}`}
                        className="font-medium text-gray-800 hover:text-brand-600"
                      >
                        {c.name}
                      </Link>
                      <div className="text-xs text-gray-500">
                        {c.stage ?? "ليد"}
                        {c.sales_employee ? ` · ${c.sales_employee}` : ""}
                      </div>
                    </div>
                    <span className="whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                      {days === null ? "لا تواصل إطلاقاً" : `منذ ${days} يوم`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="text-xs text-gray-400">
          التنبيهات تُفحص تلقائياً كل يوم ٩ صباحاً بتوقيت بغداد: تذكير للموظف بمتابعات
          اليوم والمتأخرة، وتصعيد للإدارة عن كل متابعة تجاوزت ٢٤ ساعة بلا تحديث حالة
          ولا تواصل.
        </p>
      </section>
    </main>
  );
}
