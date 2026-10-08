import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { dirOf } from "@/lib/i18n/config";
import { fmtValue, type Unit } from "@/lib/dashboard/format";

// ============================================================
// الرسوم البيانية — مكوّنات خادم: SVG وHTML بلا مكتبة ولا JavaScript.
//
// لماذا بلا مكتبة: مكتبات الرسم الشائعة مكوّنات عميل (Recharts ~٩٠ك.ب
// مضغوطة) تُرسم بعد التحميل. ما نحتاجه هنا أربعة أشكال بسيطة، فتُرسم
// على الخادم وتصل جاهزة: لا وميض، ولا حزمة، ولا انتظار ترطيب.
//
// القواعد (مهارة dataviz):
//   • محور واحد دائماً — لا محورين لمقياسين.
//   • خطوط ٢px، أعمدة ≤ ٢٤px بطرف مدوّر ٤px، فجوة ٢px بين المتجاورة.
//   • الفترة السابقة رمادي خافت؛ لون الهوية للحالية وحدها.
//   • تلميح عند المرور **وعند التركيز بلوحة المفاتيح**، وجدول بديل دائماً.
//   • النصّ بألوان الحبر لا بلون السلسلة.
//   • في العربية يجري الزمن من اليمين إلى اليسار (كبقية الصفحة).
// ============================================================

const TIP_BASE =
  "pointer-events-none invisible absolute top-0 z-20 min-w-[9rem] rounded-lg border border-line bg-surface px-3 py-2 text-start opacity-0 shadow-card-hover transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100";

// التلميح يُثبَّت داخل الرسم: أوّل الثلث من بدايته، وآخره من نهايته، والوسط
// في المنتصف — كي لا يخرج عن حافة الشاشة فيظهر تمرير أفقي على الجوّال.
function tipPos(i: number, n: number): { cls: string; style?: React.CSSProperties } {
  if (n <= 2 || i < n / 3) return { cls: `${TIP_BASE} start-0` };
  if (i >= (2 * n) / 3) return { cls: `${TIP_BASE} end-0` };
  return { cls: `${TIP_BASE} -translate-x-1/2`, style: { left: "50%" } };
}

function useWords() {
  const { locale, t } = getI18n();
  const c = t.dash.common;
  return {
    locale,
    t,
    rtl: dirOf(locale) === "rtl",
    fmt: (n: number | null | undefined, unit: Unit) => fmtValue(n, unit, locale, { currency: c.currency, days: c.days }),
  };
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * p;
}

function LineKey({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-0 w-3 shrink-0 border-t-2"
      style={{ borderColor: color, borderTopStyle: dashed ? "dashed" : "solid" }}
    />
  );
}

function SwatchKey({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />;
}

function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  const { t } = getI18n();
  return (
    <details className="mt-3 text-xs">
      <summary className="dash-focus cursor-pointer select-none rounded font-semibold text-ink-secondary hover:text-ink">
        {t.dash.common.showTable}
      </summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
        <table className="num-tabular w-full text-start">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-surface-subtle text-ink-secondary">
            <tr>{head.map((h) => <th key={h} scope="col" className="px-3 py-1.5 text-start font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((c, j) => <td key={j} className="px-3 py-1.5 text-start text-ink">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ============================================================
// ١) الاتجاه الزمني: الحالية خطّاً بغسلةٍ تحته، والسابقة خطّاً متقطّعاً
// ============================================================
export type TrendPoint = { key: string; label: string; current: number; previous: number | null };

export function TrendChart({
  points, unit, title, height = 220,
}: { points: TrendPoint[]; unit: Unit; title: string; height?: number }) {
  const { t, rtl, fmt } = useWords();
  const c = t.dash.common;
  const n = points.length;
  const hasPrev = points.some((p) => p.previous !== null);
  const max = niceMax(Math.max(0, ...points.map((p) => Math.max(p.current, p.previous ?? 0))));
  const W = 1000;
  const H = height;
  const pad = 8;
  const x = (i: number) => {
    const v = ((i + 0.5) / n) * W;
    return rtl ? W - v : v;
  };
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const path = (vals: (number | null)[]) =>
    vals
      .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .map((p, i) => `${i === 0 ? "M" : "L"}${p}`)
      .join(" ");
  const cur = path(points.map((p) => p.current));
  const area = n > 0 ? `${cur} L${x(n - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z` : "";
  const prev = hasPrev ? path(points.map((p) => p.previous)) : "";
  const every = Math.max(1, Math.ceil(n / 7));
  const last = points[n - 1];

  return (
    <figure role="group" aria-label={title} className="overflow-x-clip">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-ink-secondary">
        <span className="inline-flex items-center gap-1.5"><LineKey color="var(--viz-1)" />{c.current}</span>
        {hasPrev && <span className="inline-flex items-center gap-1.5"><LineKey color="var(--viz-prev)" dashed />{c.previous}</span>}
      </div>
      <div className="flex gap-2">
        {/* محور القيم: صفر ونصف وأقصى — يحمل ما لم يُوسَم مباشرة */}
        <div className="num-tabular flex shrink-0 flex-col justify-between py-1 text-[10px] text-ink-muted" style={{ height }} aria-hidden="true">
          <span>{fmt(max, unit)}</span>
          <span>{fmt(max / 2, unit)}</span>
          <span dir="ltr">0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden="true">
            {[0, 0.5, 1].map((f) => (
              <line key={f} x1={0} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--viz-grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {n > 0 && <path d={area} fill="var(--viz-1-wash)" />}
            {prev && <path d={prev} fill="none" stroke="var(--viz-prev)" strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />}
            {n > 0 && <path d={cur} fill="none" stroke="var(--viz-1)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />}
          </svg>
          {/* نقطة النهاية — HTML كي لا تتشوّه بتمدّد الـSVG */}
          {last && (
            <span
              aria-hidden="true"
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
              style={{ background: "var(--viz-1)", left: `${(x(n - 1) / W) * 100}%`, top: `${(y(last.current) / H) * 100}%` }}
            />
          )}
          {/* أعمدة اللمس: كل عمود هدف المرور والتركيز لنقطته */}
          <div className="absolute inset-0 flex">
            {points.map((p, i) => (
              <div key={p.key} tabIndex={0} className="group dash-focus relative flex-1 outline-none" aria-label={`${p.label}: ${fmt(p.current, unit)}`}>
                <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-line-strong opacity-0 group-hover:opacity-100 group-focus:opacity-100" />
                <div className={tipPos(i, n).cls} style={tipPos(i, n).style}>
                  <p className="text-[11px] text-ink-muted">{p.label}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-ink">
                    <LineKey color="var(--viz-1)" />{fmt(p.current, unit)}
                  </p>
                  {p.previous !== null && (
                    <p className="flex items-center gap-1.5 text-xs text-ink-secondary">
                      <LineKey color="var(--viz-prev)" dashed />{fmt(p.previous, unit)}
                    </p>
                  )}
                </div>
                {i % every === 0 && (
                  <span className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-ink-muted">
                    {p.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="h-5" />
      <DataTable
        caption={title}
        head={[c.period, c.current, ...(hasPrev ? [c.previous] : [])]}
        rows={points.map((p) => [p.label, fmt(p.current, unit), ...(hasPrev ? [fmt(p.previous, unit)] : [])])}
      />
    </figure>
  );
}

// ============================================================
// ٢) أعمدة مزدوجة: الدخل مقابل الصرف لكل شهر
// ============================================================
export function ColumnPairs({
  groups, aLabel, bLabel, unit, title, height = 200,
}: {
  groups: { key: string; label: string; a: number; b: number }[];
  aLabel: string; bLabel: string; unit: Unit; title: string; height?: number;
}) {
  const { t, fmt } = useWords();
  const max = niceMax(Math.max(0, ...groups.flatMap((g) => [g.a, g.b])));
  const pct = (v: number) => `${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}%`;
  return (
    <figure role="group" aria-label={title} className="overflow-x-clip">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-ink-secondary">
        <span className="inline-flex items-center gap-1.5"><SwatchKey color="var(--viz-1)" />{aLabel}</span>
        <span className="inline-flex items-center gap-1.5"><SwatchKey color="var(--viz-2)" />{bLabel}</span>
      </div>
      <div className="relative flex items-end gap-2 border-b border-line" style={{ height }}>
        {groups.map((g, gi) => (
          <div key={g.key} tabIndex={0} className="group dash-focus relative flex h-full flex-1 items-end justify-center gap-[2px] rounded outline-none" aria-label={`${g.label}: ${aLabel} ${fmt(g.a, unit)}، ${bLabel} ${fmt(g.b, unit)}`}>
            <div className="w-full max-w-[24px] rounded-t transition group-hover:brightness-110" style={{ height: pct(g.a), background: "var(--viz-1)" }} />
            <div className="w-full max-w-[24px] rounded-t transition group-hover:brightness-110" style={{ height: pct(g.b), background: "var(--viz-2)" }} />
            <div className={tipPos(gi, groups.length).cls} style={tipPos(gi, groups.length).style}>
              <p className="text-[11px] text-ink-muted">{g.label}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-ink"><SwatchKey color="var(--viz-1)" /><span className="text-xs font-normal text-ink-secondary">{aLabel}</span><span>{fmt(g.a, unit)}</span></p>
              <p className="flex items-center gap-1.5 text-sm font-bold text-ink"><SwatchKey color="var(--viz-2)" /><span className="text-xs font-normal text-ink-secondary">{bLabel}</span><span>{fmt(g.b, unit)}</span></p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        {groups.map((g) => <span key={g.key} className="flex-1 truncate text-center text-[10px] text-ink-muted">{g.label}</span>)}
      </div>
      <DataTable caption={title} head={[t.dash.common.period, aLabel, bLabel]} rows={groups.map((g) => [g.label, fmt(g.a, unit), fmt(g.b, unit)])} />
    </figure>
  );
}

// ============================================================
// ٣) قائمة أشرطة أفقية مرتّبة — للمقارنة بين فئات (مصدر، مشروع، سبب)
// ============================================================
export type BarRow = { key: string; label: string; value: number; href?: string; sub?: string; badge?: React.ReactNode };

export function BarList({
  rows, unit, title, max: maxIn, color = "var(--viz-1)", limit = 6, valueSuffix,
}: {
  rows: BarRow[]; unit: Unit; title: string; max?: number; color?: string; limit?: number; valueSuffix?: (r: BarRow) => string;
}) {
  const { t, fmt } = useWords();
  const shown = rows.slice(0, limit);
  const max = maxIn ?? Math.max(1, ...shown.map((r) => r.value));
  return (
    <figure role="group" aria-label={title} className="overflow-x-clip">
      <ul className="space-y-3">
        {shown.map((r) => {
          const inner = (
            <>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-ink">{r.label}</span>
                  {r.badge}
                </span>
                <span className="num-tabular shrink-0 font-bold text-ink">
                  {fmt(r.value, unit)}{valueSuffix ? <span className="ms-1 text-xs font-normal text-ink-muted">{valueSuffix(r)}</span> : null}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                <div className="h-full rounded-full" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%`, background: color }} />
              </div>
              {r.sub && <p className="mt-1 text-[11px] text-ink-muted">{r.sub}</p>}
            </>
          );
          return (
            <li key={r.key}>
              {r.href ? (
                <Link href={r.href} className="dash-focus -m-1.5 block rounded-lg p-1.5 transition hover:bg-surface-subtle">{inner}</Link>
              ) : inner}
            </li>
          );
        })}
      </ul>
      {rows.length > shown.length && (
        <p className="mt-2 text-[11px] text-ink-muted">+{rows.length - shown.length} {t.dash.common.others}</p>
      )}
    </figure>
  );
}

// ============================================================
// ٤) القِمع: كم بلغ كل مرحلة، وتحويل كل خطوة من التي قبلها
// ============================================================
export type FunnelRow = { key: string; label: string; value: number; conversion: number | null; href?: string };

export function Funnel({ steps, title }: { steps: FunnelRow[]; title: string }) {
  const { t, fmt } = useWords();
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <figure role="group" aria-label={title} className="overflow-x-clip">
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const w = Math.max(s.value > 0 ? 4 : 0, (s.value / top) * 100);
          const body = (
            <>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="font-semibold text-ink">{s.label}</span>
                <span className="num-tabular text-ink-secondary">
                  <b className="text-ink">{fmt(s.value, "count")}</b>
                  {i > 0 && s.conversion !== null && <span className="ms-2 text-ink-muted" title={t.dash.charts.stepConversion}>{fmt(s.conversion, "pct")}</span>}
                </span>
              </div>
              <div className="h-6 rounded-md bg-surface-sunken">
                <div className="h-full rounded-md" style={{ width: `${w}%`, background: "var(--viz-1)", opacity: 1 - i * 0.12 }} />
              </div>
            </>
          );
          return (
            <li key={s.key}>
              {s.href ? <Link href={s.href} className="dash-focus -m-1 block rounded-lg p-1 hover:bg-surface-subtle">{body}</Link> : body}
            </li>
          );
        })}
      </ol>
      <DataTable
        caption={title}
        head={[t.dash.table.stage, t.dash.charts.reached, t.dash.charts.stepConversion]}
        rows={steps.map((s, i) => [s.label, fmt(s.value, "count"), i === 0 || s.conversion === null ? "—" : fmt(s.conversion, "pct")])}
      />
    </figure>
  );
}

// ============================================================
// ٥) مقياس نسبة (التصريف): الشريط يحمل الحالة، والمسار من نفس الدرجة
// ============================================================
export function Meter({ value, label }: { value: number | null; label: string }) {
  const v = value ?? 0;
  const color = v >= 60 ? "var(--viz-1)" : v >= 30 ? "#b45309" : "#b91c1c";
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label} className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, v)}%`, background: color }} />
    </div>
  );
}
