import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getInventoryItems, getRecentMoves, lowStockItems, summarize } from "@/lib/inventory";
import { getTeamMembers } from "@/lib/projects";
import { getMyFollowUps } from "@/lib/client-followups";
import {
  Attendance,
  Leave,
  STOCK_STATE_COLORS,
  Task,
  formatPrice,
  formatQty,
  isOpenTask,
  stockState,
} from "@/lib/types";
import { todayISO } from "@/lib/attendance";
import TodayTasks from "@/components/today-tasks";
import ClientFollowUps from "@/components/client-followups";

// ============================================================
// لوحة مدير المتابعة — ملفّ واحد لكل ما يحتاج متابعة يومية:
//   المخزون + الموظفون + الاتصالات + المهام المفتوحة.
//
// الترتيب مقصود: ما ينفد أولاً (لأنه يوقف العمل)، ثم ما تأخّر من
// مهام، ثم المتابعات، ثم الحركة الأخيرة للاطمئنان.
// ============================================================
export default async function FollowupDashboard() {
  const supabase = await createClient();
  const today = todayISO();

  const [items, moves, members, followUps, { data: taskData }, { data: attData }, { data: leaveData }] =
    await Promise.all([
      getInventoryItems(),
      getRecentMoves(8),
      getTeamMembers(),
      getMyFollowUps(),
      supabase
        .from("tasks")
        .select("*")
        .in("status", ["جديدة", "قيد التنفيذ"])
        .order("due_date", { ascending: true })
        .limit(300),
      supabase.from("attendance").select("*").eq("work_date", today),
      supabase.from("leaves").select("*").eq("status", "معلقة").order("start_date"),
    ]);

  const low = lowStockItems(items);
  const summary = summarize(items);
  const tasks = ((taskData ?? []) as Task[]).filter((t) => isOpenTask(t.status));
  const lateTasks = tasks.filter((t) => t.due_date < today);
  const attendance = (attData ?? []) as Attendance[];
  const pendingLeaves = (leaveData ?? []) as Leave[];

  const activeMembers = members.filter((m) => m.status === "active");
  const presentToday = activeMembers.filter((m) =>
    attendance.some((a) => a.employee_id === m.id && a.check_in)
  ).length;

  const purchases = moves.filter((m) => m.kind === "شراء").slice(0, 5);
  const issues = moves.filter((m) => m.kind === "صرف").slice(0, 5);

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
      icon: "warning",
      label: "مواد تحتاج شراء",
      value: String(summary.low),
      href: "/dashboard/inventory?state=low",
      accent: summary.low ? "border-s-amber-500" : "border-s-emerald-500",
      iconColor: summary.low
        ? "text-amber-700 bg-amber-50"
        : "text-emerald-700 bg-emerald-50",
    },
    {
      icon: "inventory_2",
      label: "مواد في المخزون",
      value: String(summary.items),
      href: "/dashboard/inventory",
      accent: "border-s-brand-600",
      iconColor: "text-brand-700 bg-brand-50",
    },
    {
      icon: "assignment_late",
      label: "مهام متأخرة",
      value: String(lateTasks.length),
      href: "/dashboard/tasks",
      accent: lateTasks.length ? "border-s-red-500" : "border-s-emerald-500",
      iconColor: lateTasks.length
        ? "text-red-700 bg-red-50"
        : "text-emerald-700 bg-emerald-50",
    },
    {
      icon: "call",
      label: "اتصالات مستحقة",
      value: String(followUps.total),
      href: "/dashboard/clients/activities",
      accent: followUps.total ? "border-s-amber-500" : "border-s-emerald-500",
      iconColor: followUps.total
        ? "text-amber-700 bg-amber-50"
        : "text-emerald-700 bg-emerald-50",
    },
    {
      icon: "groups",
      label: "حاضرون اليوم",
      value: `${presentToday} / ${activeMembers.length}`,
      href: "/dashboard/followup/employees",
      accent: "border-s-blue-500",
      iconColor: "text-blue-700 bg-blue-50",
    },
  ];

  return (
    <main className="p-6 lg:p-8">
      <section className="mb-6">
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-gray-400">
          {dateLabel}
        </p>
        <h1 className="text-3xl font-bold text-brand-900">{greeting} 👋</h1>
        <p className="mt-1 text-gray-500">
          متابعة اليوم التشغيلية: المخزون والموظفون والاتصالات والمهام.
        </p>
      </section>

      {/* المؤشرات */}
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className={`glass-card border-s-4 ${k.accent} p-5 transition hover:shadow-md`}>
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

      {/* أوشكت على النفاد */}
      <section className="mb-6">
        <div className="glass-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-lg font-bold text-brand-900">مواد أوشكت على النفاد</h4>
            <Link
              href="/dashboard/inventory"
              className="text-sm font-bold text-brand-700 hover:underline"
            >
              المخزون كاملاً
            </Link>
          </div>
          {low.length === 0 ? (
            <p className="text-sm text-emerald-700">
              كل المواد فوق حدّها الأدنى — لا شيء عاجل اليوم.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-start text-sm">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">المادة</th>
                    <th className="px-3 py-2 text-start font-medium">المتبقي</th>
                    <th className="px-3 py-2 text-start font-medium">الحد الأدنى</th>
                    <th className="px-3 py-2 text-start font-medium">المورد</th>
                    <th className="px-3 py-2 text-start font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {low.slice(0, 8).map((i) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <Link
                          href={`/dashboard/inventory/${i.id}`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          {i.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                            STOCK_STATE_COLORS[stockState(i)]
                          }`}
                        >
                          {formatQty(i.quantity)} {i.unit}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {formatQty(i.min_quantity)} {i.unit}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {i.suppliers?.name ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/dashboard/inventory/moves/new?item=${i.id}&kind=${encodeURIComponent("شراء")}`}
                          className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          تسجيل شراء
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {low.length > 8 && (
                <p className="mt-3 text-xs text-gray-400">
                  و{low.length - 8} مادة أخرى — افتح المخزون لرؤيتها.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* مهام اليوم + متابعات العملاء */}
      <section className="mb-6">
        <TodayTasks />
      </section>
      <section className="mb-6">
        <ClientFollowUps compact />
      </section>

      {/* آخر الحركة + إجازات معلّقة */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="glass-card p-6">
          <h4 className="mb-4 text-lg font-bold text-brand-900">آخر المشتريات</h4>
          {purchases.length === 0 ? (
            <p className="text-sm text-gray-400">لا مشتريات مسجّلة بعد.</p>
          ) : (
            <div className="space-y-3">
              {purchases.map((m) => (
                <div key={m.id} className="border-b border-gray-100 pb-2 last:border-0">
                  <div className="flex justify-between gap-2">
                    <Link
                      href={`/dashboard/inventory/${m.item_id}`}
                      className="font-medium text-gray-800 hover:text-brand-700"
                    >
                      {m.inventory_items?.name ?? "—"}
                    </Link>
                    <span className="text-sm font-bold text-emerald-700" dir="ltr">
                      +{formatQty(m.quantity)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex justify-between text-xs text-gray-400">
                    <span dir="ltr">{m.moved_at}</span>
                    <span dir="ltr">{formatPrice(m.total_price)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-card p-6">
          <h4 className="mb-4 text-lg font-bold text-brand-900">آخر عمليات الصرف</h4>
          {issues.length === 0 ? (
            <p className="text-sm text-gray-400">لا صرف مسجّل بعد.</p>
          ) : (
            <div className="space-y-3">
              {issues.map((m) => (
                <div key={m.id} className="border-b border-gray-100 pb-2 last:border-0">
                  <div className="flex justify-between gap-2">
                    <Link
                      href={`/dashboard/inventory/${m.item_id}`}
                      className="font-medium text-gray-800 hover:text-brand-700"
                    >
                      {m.inventory_items?.name ?? "—"}
                    </Link>
                    <span className="text-sm font-bold text-red-700" dir="ltr">
                      −{formatQty(m.quantity)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex justify-between text-xs text-gray-400">
                    <span dir="ltr">{m.moved_at}</span>
                    <span>{m.issued_to ?? m.actor_name ?? ""}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-lg font-bold text-brand-900">الموظفون</h4>
            <Link
              href="/dashboard/followup/employees"
              className="text-sm font-bold text-brand-700 hover:underline"
            >
              التفاصيل
            </Link>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between rounded-xl bg-gray-50 px-4 py-3">
              <span className="text-gray-600">حاضرون اليوم</span>
              <b className="text-gray-800">
                {presentToday} / {activeMembers.length}
              </b>
            </div>
            <div className="flex justify-between rounded-xl bg-gray-50 px-4 py-3">
              <span className="text-gray-600">طلبات إجازة معلّقة</span>
              <b className={pendingLeaves.length ? "text-amber-700" : "text-gray-800"}>
                {pendingLeaves.length}
              </b>
            </div>
            <div className="flex justify-between rounded-xl bg-gray-50 px-4 py-3">
              <span className="text-gray-600">مهام مفتوحة (الكل)</span>
              <b className="text-gray-800">{tasks.length}</b>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
