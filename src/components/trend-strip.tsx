import { getTrend, fmt, type TrendMetric, type TrendScope } from "@/lib/crm";

// ============================================================
// شريط الاتجاهات — الرقم مع اتجاهه لا الرقم وحده (§55).
//
// يقرأ من اللقطات اليومية (sql/076) التي تُؤخذ ١١ مساءً. لذلك:
//   • قبل تشغيل اللقطة الأولى لا يظهر شيء — لا نرسم خطاً من نقطة.
//   • «مقارنة بقبل أسبوع» = أول لقطة قبل ٧ أيام أو أقرب ما قبلها.
//
// رسم SVG خفيف بلا مكتبة: خطٌّ واحد لكل مؤشّر، والغاية شكل الاتجاه
// لا قراءة القيم منه — القيم في الجدول تحته.
// ============================================================
const METRICS: { key: TrendMetric; label: string; goodWhen: "up" | "down"; pct?: boolean }[] = [
  { key: "leads", label: "ليدات", goodWhen: "up" },
  { key: "open_count", label: "فرص مفتوحة", goodWhen: "up" },
  { key: "weighted_pipeline", label: "الأنابيب الموزونة", goodWhen: "up" },
  { key: "conversion_rate", label: "معدّل التحويل", goodWhen: "up", pct: true },
  { key: "overdue_count", label: "متأخرة", goodWhen: "down" },
  { key: "neglected_count", label: "مهملة", goodWhen: "down" },
];

export default async function TrendStrip({
  days = 30,
  scope = "كلي",
  scopeId = null,
  scopeName,
}: {
  days?: number;
  scope?: TrendScope["scope"];
  scopeId?: string | null;
  /** اسم الفريق في العنوان — فلا يُقرأ رقم فريقٍ على أنه رقم الشركة */
  scopeName?: string;
}) {
  const series = await Promise.all(METRICS.map((m) => getTrend(m.key, days, scope, scopeId)));
  if (series.every((s) => s.length < 2)) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold text-gray-800">
          الاتجاه — آخر {days} يوماً{scopeName ? ` · ${scopeName}` : ""}
        </h2>
        <span className="text-xs text-gray-400">من اللقطة اليومية (١١ مساءً)</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {METRICS.map((m, i) => {
          const pts = series[i];
          if (pts.length < 2) {
            return (
              <div key={m.key} className="rounded-lg border border-dashed border-gray-200 bg-white p-3 text-xs text-gray-400">
                {m.label}: لقطتان على الأقل مطلوبتان
              </div>
            );
          }
          const last = Number(pts[pts.length - 1].value);
          const weekAgoIdx = Math.max(0, pts.length - 8);
          const prev = Number(pts[weekAgoIdx].value);
          const delta = last - prev;
          const good = delta === 0 ? null : (delta > 0) === (m.goodWhen === "up");
          return (
            <div key={m.key} className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs text-gray-500">{m.label}</p>
              <div className="flex items-baseline justify-between">
                <p className="text-lg font-bold text-gray-800">{m.pct ? `${last}%` : fmt(last)}</p>
                {delta !== 0 && (
                  <span className={`text-xs font-semibold ${good ? "text-brand-700" : "text-red-600"}`} dir="ltr">
                    {delta > 0 ? "+" : ""}{m.pct ? `${Math.round(delta * 10) / 10}` : fmt(delta)}
                  </span>
                )}
              </div>
              <Sparkline points={pts.map((p) => Number(p.value))} good={good} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Sparkline({ points, good }: { points: number[]; good: boolean | null }) {
  const w = 120;
  const h = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke = good === null ? "#9ca3af" : good ? "#064e3b" : "#dc2626";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-7 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}
