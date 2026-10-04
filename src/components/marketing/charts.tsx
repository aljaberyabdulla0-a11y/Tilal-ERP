import { fmt } from "@/lib/marketing-style";

// ============================================================
// رسوم التسويق — سلسلةٌ واحدة في كل رسم، بلونٍ واحد للمقدار.
//
// قراران لا ذوق فيهما:
//   • لا محوران: الكلفة والليدات رسمان متجاوران لا رسمٌ بمقياسين —
//     المقياس الثاني يخترع علاقةً بين خطّين لا وجود لها.
//   • الرقم بحبر النصّ لا بلون العمود، والعمود يحمل القيمة في title
//     (تلميح المرور) — والجدول تحت كل رسم هو العرض البديل.
// ============================================================

export function HBars({
  rows,
  unit,
  empty = "لا بيانات في المدة",
}: {
  rows: { key: string; label: string; value: number; note?: string; href?: string }[];
  unit?: string;
  empty?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0 || max === 0) {
    return <p className="py-6 text-center text-sm text-gray-400">{empty}</p>;
  }
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const pct = Math.max(1.5, (r.value / max) * 100);
        const label = r.href ? (
          <a href={r.href} className="truncate text-gray-700 hover:text-brand-600 hover:underline">{r.label}</a>
        ) : (
          <span className="truncate text-gray-700">{r.label}</span>
        );
        return (
          <li key={r.key} className="group">
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              {label}
              <span className="shrink-0 font-semibold tabular-nums text-gray-800">
                {fmt(r.value)}{unit ? ` ${unit}` : ""}
                {r.note && <span className="ms-1 font-normal text-gray-400">{r.note}</span>}
              </span>
            </div>
            <div className="h-2.5 w-full rounded bg-gray-100">
              <div
                className="h-2.5 rounded-e bg-brand-500 transition group-hover:bg-brand-600"
                style={{ width: `${pct}%` }}
                title={`${r.label}: ${fmt(r.value)}${unit ? ` ${unit}` : ""}`}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Columns({
  points,
  unit,
  height = 120,
}: {
  points: { key: string; label: string; value: number }[];
  unit?: string;
  height?: number;
}) {
  const max = Math.max(0, ...points.map((p) => p.value));
  if (points.length === 0 || max === 0) {
    return <p className="py-6 text-center text-sm text-gray-400">لا بيانات في المدة</p>;
  }
  // تسميةٌ انتقائية: الأول والأخير والأعلى — لا رقم فوق كل عمود
  const peak = points.reduce((a, p) => (p.value > a.value ? p : a), points[0]);
  const labelled = new Set([points[0].key, points[points.length - 1].key, peak.key]);
  return (
    <div dir="ltr">
      <div className="flex items-end gap-[2px] border-b border-gray-200" style={{ height }}>
        {points.map((p) => (
          <div key={p.key} className="group relative flex h-full flex-1 items-end">
            <div
              className="w-full rounded-t bg-brand-500 transition group-hover:bg-brand-600"
              style={{ height: `${Math.max(p.value > 0 ? 2 : 0, (p.value / max) * 100)}%` }}
              title={`${p.label}: ${fmt(p.value)}${unit ? ` ${unit}` : ""}`}
            />
            {labelled.has(p.key) && p.value > 0 && (
              <span className="pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums text-gray-500">
                {fmt(p.value)}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>{points[0].label}</span>
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  );
}

// القمع: عرض كل خطوة نسبةً من الأولى غير الصفرية، ونسبة الانتقال بجانبها
export function FunnelBars({
  steps,
}: {
  steps: { code: string; label: string; value: number; from_previous: number | null }[];
}) {
  const max = Math.max(0, ...steps.map((s) => Number(s.value)));
  if (max === 0) return <p className="py-6 text-center text-sm text-gray-400">لا بيانات في المدة</p>;
  return (
    <ul className="space-y-1.5">
      {steps.map((s) => {
        const v = Number(s.value);
        return (
          <li key={s.code} className="grid grid-cols-[7rem_1fr_7rem] items-center gap-3 text-xs">
            <span className="text-gray-600">{s.label}</span>
            <div className="h-5 rounded bg-gray-50">
              <div
                className="h-5 rounded-e bg-brand-500"
                style={{ width: `${v > 0 ? Math.max(1, (v / max) * 100) : 0}%` }}
                title={`${s.label}: ${fmt(v)}`}
              />
            </div>
            <span className="tabular-nums text-gray-800">
              <b>{fmt(v)}</b>
              {s.from_previous != null && <span className="ms-1 text-gray-400">({fmt(s.from_previous)}٪)</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
