"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { compareValues } from "@/lib/report-engine";
import { useI18n } from "@/lib/i18n/client";
import { DeltaChip } from "./ui";

// ============================================================
// رسوم المعاينة — HTML وCSS بلا مكتبة، كرسوم النظام القائمة.
//
// «الأفق» (Skyline) هو التوقيع البصري الوحيد في المعاينة: أعمدة المبيعات
// أبراجٌ قائمة كأبراج شعار تلال، والفترة السابقة شَرطةٌ رمادية على
// ارتفاعها — مقارنةٌ بلا عمود ثانٍ يضاعف الحبر.
//
// قواعد dataviz المطبّقة:
//   • محور واحد؛ خطوط الشبكة شعرية صلبة خافتة.
//   • العمود ≤ 24px بطرف مدوّر 4px وقاعدة مربّعة.
//   • تسمية انتقائية: الذروة وحدها على رأسها، والباقي بالتلميح والجدول.
//   • النصّ بألوان الحبر لا بلون السلسلة.
//   • الرسم كلّه نقطة تركيز واحدة تُجال بالأسهم (لا 30 محطة Tab)،
//     والتلميح يُعلَن لقارئ الشاشة.
//   • في العربية يجري الزمن من اليمين إلى اليسار كبقية الصفحة.
// ============================================================

export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * p;
}

// التلميح يُثبَّت داخل الرسم بحسب الثلث كي لا يخرج عن حافة الشاشة
function anchorStyle(i: number, n: number): React.CSSProperties {
  if (n <= 2 || i < n / 3) return { insetInlineStart: `${(i / n) * 100}%` };
  if (i >= (2 * n) / 3) return { insetInlineEnd: `${((n - i - 1) / n) * 100}%` };
  return { insetInlineStart: `${((i + 0.5) / n) * 100}%`, transform: "translateX(var(--tp-center))" };
}

function useRoving(n: number) {
  const { dir } = useI18n();
  const [active, setActive] = useState<number | null>(null);
  function onKeyDown(e: React.KeyboardEvent) {
    const next = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const prev = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    if (e.key === next) { e.preventDefault(); setActive((a) => Math.min(n - 1, (a ?? -1) + 1)); }
    else if (e.key === prev) { e.preventDefault(); setActive((a) => Math.max(0, (a ?? n) - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(n - 1); }
    else if (e.key === "Escape") setActive(null);
  }
  return {
    active,
    setActive,
    plotProps: {
      tabIndex: 0,
      onKeyDown,
      onFocus: () => setActive((a) => a ?? n - 1),
      onBlur: () => setActive(null),
      onMouseLeave: () => setActive(null),
    },
  };
}

function YAxis({ max, fmt }: { max: number; fmt: (n: number) => string }) {
  return (
    <div aria-hidden="true" className="tp-tabular relative w-[60px] shrink-0 text-[11px] text-tp-ink-3">
      {[1, 0.5, 0].map((r) => (
        <span key={r} className="absolute end-1 -translate-y-1/2" style={{ top: `${(1 - r) * 100}%` }}>
          {fmt(max * r)}
        </span>
      ))}
    </div>
  );
}

function Grid() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {[0, 0.5, 1].map((r) => (
        <div key={r} className={`absolute inset-x-0 h-px ${r === 1 ? "bg-tp-line-strong" : "bg-tp-line"}`} style={{ top: `${r * 100}%` }} />
      ))}
    </div>
  );
}

function XLabels({ labels }: { labels: string[] }) {
  const n = labels.length;
  // تسمية لكل 72px من العرض المقيس (سبع على الأكثر)، والأخيرة دائماً —
  // وما يزاحمها قبلها يُترك. على الجوّال كانت سبع تسميات تتراكب.
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = Math.max(2, Math.min(7, Math.floor((width - 60) / 72)));
  const every = Math.max(1, Math.ceil(n / max));
  const show = (i: number) => i === n - 1 || (i % every === 0 && n - 1 - i >= Math.ceil(every / 2));
  return (
    <div ref={ref} aria-hidden="true" className="flex ps-[60px]">
      {labels.map((l, i) => (
        <div key={i} className="relative h-6 min-w-0 flex-1 text-[11px] text-tp-ink-3">
          {show(i) && <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap">{l}</span>}
        </div>
      ))}
    </div>
  );
}

function Tip({ i, n, children }: { i: number; n: number; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute bottom-full z-20 mb-2 min-w-[10rem] rounded-lg border border-tp-line bg-tp-surface px-3 py-2 text-start shadow-tp-overlay [--tp-center:-50%] rtl:[--tp-center:50%]"
      style={anchorStyle(i, n)}
    >
      {children}
    </div>
  );
}

function LegendKey({ className, line = false }: { className: string; line?: boolean }) {
  return line
    ? <span aria-hidden="true" className={`inline-block h-[2px] w-3.5 rounded-full ${className}`} />
    : <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-[3px] ${className}`} />;
}

export function Legend({ items }: { items: { label: string; className: string; line?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tp-ink-2">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <LegendKey className={it.className} line={it.line} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

// ===== الأفق: المبيعات عبر الزمن + شَرطة الفترة السابقة =====

export type SkyPoint = { key: string; label: string; current: number; previous: number | null };

export function Skyline({
  points, title, fmt, axisFmt, height = "h-60",
}: {
  points: SkyPoint[]; title: string; fmt: (n: number) => string; axisFmt: (n: number) => string; height?: string;
}) {
  const { t } = useI18n();
  const c = t.dash.common;
  const n = points.length;
  const max = niceMax(Math.max(...points.map((p) => Math.max(p.current, p.previous ?? 0)), 1));
  const peak = points.reduce((best, p, i) => (p.current > points[best].current ? i : best), 0);
  const { active, setActive, plotProps } = useRoving(n);
  const live = useId();
  const a = active !== null ? points[active] : null;

  return (
    <figure>
      {/* مسافة فوق الرسم لتسمية الذروة حين يبلغ عمودها السقف */}
      <div className={`relative mt-5 flex ${height}`}>
        <YAxis max={max} fmt={axisFmt} />
        <div
          {...plotProps}
          role="group"
          aria-label={title}
          aria-describedby={live}
          className="tp-focus relative flex flex-1 items-end rounded-sm"
        >
          <Grid />
          {points.map((p, i) => {
            const h = (p.current / max) * 100;
            const on = active === i;
            const dim = active !== null && !on;
            return (
              <div
                key={p.key}
                onMouseEnter={() => setActive(i)}
                className="relative flex h-full min-w-0 flex-1 items-end justify-center"
              >
                {on && <div aria-hidden="true" className="absolute inset-y-0 inset-x-[8%] rounded-sm bg-tp-sunken/70" />}
                {p.current > 0 && (
                  <div
                    className={`tp-rise relative w-[min(24px,62%)] rounded-t-[4px] transition-opacity duration-150 ${dim ? "opacity-45" : ""} bg-tp-viz1`}
                    style={{ height: `${h}%`, animationDelay: `${Math.min(i * 14, 400)}ms` }}
                  />
                )}
                {p.previous !== null && p.previous > 0 && (
                  <div
                    aria-hidden="true"
                    className="absolute h-[2px] w-[min(30px,78%)] rounded-full bg-tp-ink-2 shadow-[0_0_0_1.5px_white]"
                    style={{ bottom: `calc(${(p.previous / max) * 100}% - 1px)` }}
                  />
                )}
                {i === peak && p.current > 0 && active === null && (
                  <span
                    aria-hidden="true"
                    className="tp-tabular absolute whitespace-nowrap text-[11px] font-semibold text-tp-ink"
                    style={{ bottom: `calc(${h}% + 6px)` }}
                  >
                    {axisFmt(p.current)}
                  </span>
                )}
              </div>
            );
          })}
          {a && active !== null && (
            <Tip i={active} n={n}>
              <p className="mb-1 text-xs font-semibold text-tp-ink">{a.label}</p>
              <p className="flex items-center justify-between gap-4 text-xs text-tp-ink-2">
                <span className="inline-flex items-center gap-1.5"><LegendKey className="bg-tp-viz1" />{c.current}</span>
                <span className="tp-tabular font-semibold text-tp-ink">{fmt(a.current)}</span>
              </p>
              {a.previous !== null && (
                <>
                  <p className="mt-0.5 flex items-center justify-between gap-4 text-xs text-tp-ink-2">
                    <span className="inline-flex items-center gap-1.5"><LegendKey className="bg-tp-ink-2" line />{c.previous}</span>
                    <span className="tp-tabular">{fmt(a.previous)}</span>
                  </p>
                  <div className="mt-1 border-t border-tp-line pt-1">
                    <DeltaChip delta={compareValues(a.current, a.previous, "up")} compact />
                  </div>
                </>
              )}
            </Tip>
          )}
        </div>
      </div>
      <XLabels labels={points.map((p) => p.label)} />
      <p id={live} aria-live="polite" className="sr-only">
        {a ? `${a.label}: ${fmt(a.current)}${a.previous !== null ? ` — ${c.previous}: ${fmt(a.previous)}` : ""}` : ""}
      </p>
    </figure>
  );
}

export function SkylineTable({ points, fmt }: { points: SkyPoint[]; fmt: (n: number) => string }) {
  const { t } = useI18n();
  const c = t.dash.common;
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-tp-line">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-tp-paper text-xs text-tp-ink-3">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-semibold">{c.period}</th>
            <th scope="col" className="px-3 py-2 text-end font-semibold">{c.current}</th>
            <th scope="col" className="px-3 py-2 text-end font-semibold">{c.previous}</th>
            <th scope="col" className="px-3 py-2 text-end font-semibold"><span className="sr-only">Δ</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-tp-line">
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row" className="px-3 py-1.5 text-start font-medium text-tp-ink">{p.label}</th>
              <td className="tp-tabular px-3 py-1.5 text-end text-tp-ink">{fmt(p.current)}</td>
              <td className="tp-tabular px-3 py-1.5 text-end text-tp-ink-2">{p.previous === null ? "—" : fmt(p.previous)}</td>
              <td className="px-3 py-1.5 text-end"><DeltaChip delta={compareValues(p.current, p.previous, "up")} compact /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// أفق مصغّر لبطاقة المؤشّر الأولى: 12 أسبوعاً، القديمة رمادية والأخير بلون الهوية
export function MiniSkyline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values, 1);
  return (
    <div role="img" aria-label={label} className="flex h-10 items-end gap-[3px]">
      {values.map((v, i) => (
        <div
          key={i}
          className={`tp-rise w-[7px] rounded-t-[2px] ${i === values.length - 1 ? "bg-tp-viz1" : "bg-tp-vizprev"}`}
          style={{ height: `${Math.max(4, (v / max) * 100)}%`, animationDelay: `${i * 30}ms` }}
        />
      ))}
    </div>
  );
}

// ===== أعمدة مزدوجة: الدخل مقابل الصرف =====

export function PairedColumns({
  groups, aLabel, bLabel, title, fmt, axisFmt,
}: {
  groups: { key: string; label: string; a: number; b: number }[];
  aLabel: string; bLabel: string; title: string;
  fmt: (n: number) => string; axisFmt: (n: number) => string;
}) {
  const n = groups.length;
  const max = niceMax(Math.max(...groups.map((g) => Math.max(g.a, g.b)), 1));
  const { active, setActive, plotProps } = useRoving(n);
  const live = useId();
  const g = active !== null ? groups[active] : null;
  return (
    <figure>
      <div className="mb-3">
        <Legend items={[{ label: aLabel, className: "bg-tp-viz1" }, { label: bLabel, className: "bg-tp-viz2" }]} />
      </div>
      <div className="relative flex h-52">
        <YAxis max={max} fmt={axisFmt} />
        <div {...plotProps} role="group" aria-label={title} aria-describedby={live} className="tp-focus relative flex flex-1 items-end rounded-sm">
          <Grid />
          {groups.map((gr, i) => (
            <div key={gr.key} onMouseEnter={() => setActive(i)} className="relative flex h-full flex-1 items-end justify-center gap-[2px]">
              {active === i && <div aria-hidden="true" className="absolute inset-y-0 inset-x-[12%] rounded-sm bg-tp-sunken/70" />}
              <div className="tp-rise relative w-[min(22px,30%)] rounded-t-[4px] bg-tp-viz1" style={{ height: `${(gr.a / max) * 100}%`, animationDelay: `${i * 40}ms` }} />
              <div className="tp-rise relative w-[min(22px,30%)] rounded-t-[4px] bg-tp-viz2" style={{ height: `${(gr.b / max) * 100}%`, animationDelay: `${i * 40 + 20}ms` }} />
            </div>
          ))}
          {g && active !== null && (
            <Tip i={active} n={n}>
              <p className="mb-1 text-xs font-semibold text-tp-ink">{g.label}</p>
              <p className="flex items-center justify-between gap-4 text-xs text-tp-ink-2">
                <span className="inline-flex items-center gap-1.5"><LegendKey className="bg-tp-viz1" />{aLabel}</span>
                <span className="tp-tabular font-semibold text-tp-ink">{fmt(g.a)}</span>
              </p>
              <p className="mt-0.5 flex items-center justify-between gap-4 text-xs text-tp-ink-2">
                <span className="inline-flex items-center gap-1.5"><LegendKey className="bg-tp-viz2" />{bLabel}</span>
                <span className="tp-tabular font-semibold text-tp-ink">{fmt(g.b)}</span>
              </p>
            </Tip>
          )}
        </div>
      </div>
      <XLabels labels={groups.map((x) => x.label)} />
      <p id={live} aria-live="polite" className="sr-only">
        {g ? `${g.label}: ${aLabel} ${fmt(g.a)}، ${bLabel} ${fmt(g.b)}` : ""}
      </p>
    </figure>
  );
}

// ===== قائمة أشرطة: قيمة على رأس كل شريط (ستة على الأكثر) =====

export function BarList({
  rows, fmt, barClass = "bg-tp-viz1",
}: { rows: { key: string; label: string; value: number }[]; fmt: (n: number) => string; barClass?: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate text-tp-ink-2">{r.label}</span>
            <span className="tp-tabular shrink-0 font-semibold text-tp-ink">{fmt(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-tp-sunken">
            <div className={`h-2 rounded-full ${barClass}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ===== القِمع: كم فرصةً بلغت كل مرحلة، ونسبة العبور بين المراحل =====

export function Funnel({ steps, fmtCount, fmtPct }: {
  steps: { key: string; label: string; value: number; conversion: number | null }[];
  fmtCount: (n: number) => string; fmtPct: (n: number) => string;
}) {
  const first = Math.max(steps[0]?.value ?? 1, 1);
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => (
        <li key={s.key}>
          {i > 0 && s.conversion !== null && (
            <p className="tp-tabular flex items-center gap-1 ps-1 text-[11px] text-tp-ink-3">
              <span aria-hidden="true" className="material-symbols-outlined text-[13px]">south</span>
              {fmtPct(s.conversion)}
            </p>
          )}
          <div className="flex items-center gap-3">
            <span className="w-24 shrink-0 truncate text-[13px] text-tp-ink-2">{s.label}</span>
            <div className="relative h-6 flex-1">
              <div className="h-6 rounded-[4px] bg-tp-viz1" style={{ width: `${Math.max(2, (s.value / first) * 100)}%` }} />
            </div>
            <span className="tp-tabular w-12 shrink-0 text-end text-[13px] font-semibold text-tp-ink">{fmtCount(s.value)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ===== مقياس نسبة (التصريف) =====

export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label} className="h-1.5 w-full rounded-full bg-tp-mint-100">
      <div className="h-1.5 rounded-full bg-tp-forest-700" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}
