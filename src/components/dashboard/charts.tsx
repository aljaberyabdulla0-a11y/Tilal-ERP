import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { dirOf } from "@/lib/i18n/config";
import { fmtCompact, fmtValue, type Unit } from "@/lib/dashboard/format";

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
// ١) الاتجاه الزمني — «الأفق» (التصميم المعتمد)
//
// أعمدة الفترة الحالية أبراجٌ قائمة كأبراج شعار تلال، والفترة السابقة
// شَرطةٌ رمادية على ارتفاعها — مقارنةٌ بلا عمود ثانٍ يضاعف الحبر.
// تسمية الذروة وحدها، والباقي بالتلميح (مرور وتركيز) والجدول.
// والزمن يجري مع اتجاه الصفحة: من اليمين بالعربية.
// ============================================================
export type TrendPoint = { key: string; label: string; current: number; previous: number | null };

export function TrendChart({
  points, unit, title, height = 220,
}: { points: TrendPoint[]; unit: Unit; title: string; height?: number }) {
  const { t, locale, fmt } = useWords();
  const c = t.dash.common;
  const n = points.length;
  const hasPrev = points.some((p) => p.previous !== null);
  const max = niceMax(Math.max(0, ...points.map((p) => Math.max(p.current, p.previous ?? 0))));
  // المحور والذروة مختصران بلا عملة — العملة في التلميح والجدول
  const short = (v: number) => (unit === "money" ? fmtCompact(v, locale) : fmt(v, unit));
  const peak = n > 0 ? points.reduce((b, p, i) => (p.current > points[b].current ? i : b), 0) : -1;
  // سبع تسميات على الأكثر على المكتب، ونصفها على الجوّال — والأخيرة دائماً
  const every = Math.max(1, Math.ceil(n / 7));
  const desk = (i: number) => i === n - 1 || (i % every === 0 && n - 1 - i >= Math.ceil(every / 2));
  const phone = (i: number) => i === n - 1 || (i % (every * 2) === 0 && n - 1 - i >= every);

  return (
    <figure role="group" aria-label={title} className="overflow-x-clip">
      <div className="flex flex-wrap items-center gap-4 text-xs text-ink-secondary">
        <span className="inline-flex items-center gap-1.5"><SwatchKey color="var(--viz-1)" />{c.current}</span>
        {hasPrev && <span className="inline-flex items-center gap-1.5"><LineKey color="var(--viz-prev-mark)" />{c.previous}</span>}
      </div>
      <div className="mt-6 flex gap-2">
        {/* محور القيم: صفر ونصف وأقصى — يحمل ما لم يُوسَم مباشرة */}
        <div className="num-tabular relative w-12 shrink-0 text-[10px] text-ink-muted" style={{ height }} aria-hidden="true">
          {[1, 0.5, 0].map((f) => (
            <span key={f} className="absolute end-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(1 - f) * 100}%` }}>
              {f === 0 ? <span dir="ltr">0</span> : short(max * f)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {[0, 0.5, 1].map((f) => (
            <div key={f} aria-hidden="true" className={`absolute inset-x-0 h-px ${f === 1 ? "bg-line-strong" : "bg-line"}`} style={{ top: `${f * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end">
            {points.map((p, i) => {
              const h = (p.current / max) * 100;
              const tip = tipPos(i, n);
              return (
                <div
                  key={p.key}
                  tabIndex={0}
                  className="group dash-focus relative flex h-full min-w-0 flex-1 items-end justify-center rounded-sm outline-none"
                  aria-label={`${p.label}: ${fmt(p.current, unit)}${p.previous !== null ? ` — ${c.previous}: ${fmt(p.previous, unit)}` : ""}`}
                >
                  <span aria-hidden="true" className="absolute inset-x-[8%] inset-y-0 rounded-sm bg-surface-sunken/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100" />
                  {p.current > 0 && (
                    <div
                      aria-hidden="true"
                      className="anim-rise relative w-[min(24px,62%)] rounded-t-[4px]"
                      style={{ height: `${h}%`, background: "var(--viz-1)", animationDelay: `${Math.min(i * 14, 400)}ms` }}
                    />
                  )}
                  {p.previous !== null && p.previous > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute h-[2px] w-[min(30px,78%)] rounded-full shadow-[0_0_0_1.5px_white]"
                      style={{ bottom: `calc(${(p.previous / max) * 100}% - 1px)`, background: "var(--viz-prev-mark)" }}
                    />
                  )}
                  {i === peak && p.current > 0 && (
                    <span aria-hidden="true" className="num-tabular pointer-events-none absolute whitespace-nowrap text-[11px] font-semibold text-ink group-hover:invisible" style={{ bottom: `calc(${h}% + 5px)` }}>
                      {short(p.current)}
                    </span>
                  )}
                  <div className={tip.cls} style={tip.style}>
                    <p className="text-[11px] text-ink-muted">{p.label}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-ink">
                      <SwatchKey color="var(--viz-1)" />{fmt(p.current, unit)}
                    </p>
                    {p.previous !== null && (
                      <p className="flex items-center gap-1.5 text-xs text-ink-secondary">
                        <LineKey color="var(--viz-prev-mark)" />{fmt(p.previous, unit)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="flex ps-14">
        {points.map((p, i) => (
          <div key={p.key} className="relative h-6 min-w-0 flex-1 text-[10px] text-ink-muted">
            {desk(i) && (
              // الطرفان يُثبَّتان على حافّتي الرسم (لا توسيط) فلا يُقصّ أولهما وآخرهما
              <span className={`absolute top-1.5 whitespace-nowrap ${i === n - 1 ? "end-0" : i === 0 ? "start-0" : "left-1/2 -translate-x-1/2"} ${phone(i) ? "" : "hidden sm:inline"}`}>{p.label}</span>
            )}
          </div>
        ))}
      </div>
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
            <div className="anim-rise w-full max-w-[24px] rounded-t-[4px] transition group-hover:brightness-110" style={{ height: pct(g.a), background: "var(--viz-1)", animationDelay: `${gi * 40}ms` }} />
            <div className="anim-rise w-full max-w-[24px] rounded-t-[4px] transition group-hover:brightness-110" style={{ height: pct(g.b), background: "var(--viz-2)", animationDelay: `${gi * 40 + 20}ms` }} />
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
                <div className="h-full rounded-md" style={{ width: `${w}%`, background: "var(--viz-1)" }} />
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
