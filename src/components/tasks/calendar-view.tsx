import Link from "next/link";
import type { TaskRow } from "@/lib/types";
import { addDays, monthGrid, shiftMonth, weekDays } from "@/lib/tasks";
import { withParams } from "@/lib/task-filters";

const WEEKDAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
const MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

// ============================================================
// التقويم: شهر (شبكة تبدأ بالسبت) أو أسبوع. المهام بلا موعد لا تظهر
// هنا — مكانها قسم «بدون موعد» في «عملي».
// ============================================================
export default function CalendarView({
  rows,
  todayISO,
  anchor,          // YYYY-MM-DD
  mode,            // month | week
  basePath,
  params,
}: {
  rows: TaskRow[];
  todayISO: string;
  anchor: string;
  mode: "month" | "week";
  basePath: string;
  params: Record<string, string>;
}) {
  const byDay = new Map<string, TaskRow[]>();
  for (const r of rows) {
    if (!r.due_date) continue;
    const list = byDay.get(r.due_date) ?? [];
    list.push(r);
    byDay.set(r.due_date, list);
  }

  const month = anchor.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const prev = mode === "month" ? `${shiftMonth(month, -1)}-01` : addDays(anchor, -7);
  const next = mode === "month" ? `${shiftMonth(month, 1)}-01` : addDays(anchor, 7);
  const days = mode === "month" ? monthGrid(anchor).days : weekDays(anchor).map((iso) => ({ iso, inMonth: true }));
  const cap = mode === "month" ? 3 : 12;

  const chip = (t: TaskRow) => (
    <Link
      key={t.id}
      href={`/dashboard/tasks/${t.id}`}
      title={`${t.title} — ${t.assigned_to_name ?? ""}`}
      className={`block truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${
        t.status === "منجزة" ? "bg-emerald-50 text-emerald-700 line-through"
        : t.is_late ? "bg-red-50 text-red-700"
        : t.priority === "عاجلة" ? "bg-orange-50 text-orange-800"
        : "bg-brand-50 text-brand-800"
      }`}
    >
      {t.due_time ? <span dir="ltr">{t.due_time.slice(0, 5)} </span> : null}{t.title}
    </Link>
  );

  return (
    <section className="dash-card p-3 sm:p-4" aria-label="تقويم المهام">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link href={withParams(basePath, params, { date: prev })} className="rounded-lg border border-gray-300 px-2 py-1 text-sm" aria-label="السابق">›</Link>
          <Link href={withParams(basePath, params, { date: todayISO })} className="rounded-lg border border-gray-300 px-3 py-1 text-sm">اليوم</Link>
          <Link href={withParams(basePath, params, { date: next })} className="rounded-lg border border-gray-300 px-2 py-1 text-sm" aria-label="التالي">‹</Link>
          <h2 className="ms-2 font-bold text-ink">
            {mode === "month" ? `${MONTHS[m - 1]} ${y}` : `أسبوع ${days[0].iso} — ${days[6].iso}`}
          </h2>
        </div>
        <div className="flex gap-1 text-sm">
          <Link href={withParams(basePath, params, { cal: null })} aria-current={mode === "month" ? "page" : undefined}
            className={`rounded-lg px-3 py-1 ${mode === "month" ? "bg-brand-600 text-white" : "border border-gray-300"}`}>شهر</Link>
          <Link href={withParams(basePath, params, { cal: "week" })} aria-current={mode === "week" ? "page" : undefined}
            className={`rounded-lg px-3 py-1 ${mode === "week" ? "bg-brand-600 text-white" : "border border-gray-300"}`}>أسبوع</Link>
        </div>
      </header>

      {/* الشبكة على الشاشات الواسعة */}
      <div className="hidden grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-surface-subtle px-2 py-1 text-center text-xs font-semibold text-gray-500">{w}</div>
        ))}
        {days.map((d) => {
          const list = byDay.get(d.iso) ?? [];
          return (
            <div key={d.iso} className={`${mode === "month" ? "min-h-24" : "min-h-64"} bg-white p-1.5 ${d.inMonth ? "" : "bg-gray-50/80 text-gray-400"}`}>
              <div className={`mb-1 text-xs ${d.iso === todayISO ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 font-bold text-white" : "text-gray-500"}`}>
                {Number(d.iso.slice(8))}
              </div>
              <div className="space-y-0.5">
                {list.slice(0, cap).map(chip)}
                {list.length > cap && (
                  <Link href={withParams(basePath, { ...params, view: "list" }, { from: d.iso, to: d.iso, cal: null, date: null })}
                    className="block text-[11px] text-brand-700 hover:underline">+{list.length - cap} أخرى</Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* قائمة أيام على الهاتف */}
      <ol className="space-y-2 md:hidden">
        {days.filter((d) => d.inMonth && (byDay.get(d.iso)?.length ?? 0) > 0).map((d) => (
          <li key={d.iso} className="rounded-xl border border-line p-2">
            <p className={`mb-1 text-xs font-bold ${d.iso === todayISO ? "text-brand-700" : "text-gray-600"}`}>
              {WEEKDAYS[(new Date(d.iso + "T00:00:00Z").getUTCDay() + 1) % 7]} <span dir="ltr">{d.iso}</span>
            </p>
            <div className="space-y-1">{(byDay.get(d.iso) ?? []).map(chip)}</div>
          </li>
        ))}
        {days.every((d) => !(byDay.get(d.iso)?.length)) && <li className="py-6 text-center text-sm text-gray-400">لا مهام في هذه الفترة.</li>}
      </ol>
    </section>
  );
}
