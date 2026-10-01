import Link from "next/link";
import { baghdadDate } from "@/lib/time";
import { addMonths, isIsoDate, monthEnd, monthStart } from "@/lib/report-dates";

// ============================================================
// فلتر الفترة للتقارير المالية — نموذج GET بلا JavaScript.
// mode="range": من/إلى (الدخل، الميزان، كشف الحساب)
// mode="asof":  حتى تاريخ (الميزانية العمومية)
// كل التواريخ بتوقيت بغداد.
// ============================================================

export type PeriodParams = { from?: string; to?: string };

// من searchParams إلى فترة صالحة — التاريخ غير الصالح يُتجاهل
export function readPeriod(sp: { from?: string; to?: string } | undefined): PeriodParams {
  return {
    from: isIsoDate(sp?.from) ? sp?.from : undefined,
    to: isIsoDate(sp?.to) ? sp?.to : undefined,
  };
}

export function periodLabel(p: PeriodParams): string {
  if (p.from && p.to) return `من ${p.from} إلى ${p.to}`;
  if (p.from) return `من ${p.from}`;
  if (p.to) return `حتى ${p.to}`;
  return "كل الفترات";
}

export default function PeriodFilter({
  basePath,
  period,
  mode = "range",
}: {
  basePath: string;
  period: PeriodParams;
  mode?: "range" | "asof";
}) {
  const today = baghdadDate();
  const thisMonth = { from: monthStart(today), to: monthEnd(today) };
  const lastMonthDay = addMonths(monthStart(today), -1);
  const lastMonth = { from: lastMonthDay, to: monthEnd(lastMonthDay) };
  const thisYear = { from: `${today.slice(0, 4)}-01-01`, to: today };

  const href = (p: PeriodParams) => {
    const q = new URLSearchParams();
    if (mode === "range" && p.from) q.set("from", p.from);
    if (p.to) q.set("to", p.to);
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  const presets: { label: string; p: PeriodParams }[] =
    mode === "range"
      ? [
          { label: "هذا الشهر", p: thisMonth },
          { label: "الشهر الماضي", p: lastMonth },
          { label: "هذه السنة", p: thisYear },
          { label: "كل الفترات", p: {} },
        ]
      : [
          { label: "اليوم", p: { to: today } },
          { label: "نهاية الشهر الماضي", p: { to: lastMonth.to } },
          { label: `نهاية ${Number(today.slice(0, 4)) - 1}`, p: { to: `${Number(today.slice(0, 4)) - 1}-12-31` } },
        ];

  const input =
    "rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none";

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4 shadow-sm print:hidden">
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
        {mode === "range" && (
          <label className="text-xs text-gray-500">
            من
            <input type="date" name="from" defaultValue={period.from} dir="ltr" className={`${input} mt-1 block`} />
          </label>
        )}
        <label className="text-xs text-gray-500">
          {mode === "range" ? "إلى" : "حتى تاريخ"}
          <input type="date" name="to" defaultValue={period.to} dir="ltr" className={`${input} mt-1 block`} />
        </label>
        <button className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
          عرض
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {presets.map((x) => (
          <Link
            key={x.label}
            href={href(x.p)}
            className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:border-brand-500 hover:text-brand-700"
          >
            {x.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
