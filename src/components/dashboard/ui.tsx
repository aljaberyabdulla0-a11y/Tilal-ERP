import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { fill, fmtCompact, fmtMoney, fmtNumber, fmtPct, fmtValue, type Unit } from "@/lib/dashboard/format";
import type { Kpi } from "@/lib/dashboard/kpi";
import type { Delta } from "@/lib/report-engine";

// ============================================================
// مكتبة مكوّنات اللوحات — مكوّنات خادم بلا حالة.
//
//   DashboardSection   قسمٌ بعنوان ووصف ورابط «عرض الكل»
//   KpiCard / KpiGrid  مؤشّر بقيمته وسياقه ومقارنته واتجاهه ونزوله
//   TrendIndicator     ↑↓ والنسبة — لونها من **معنى** المؤشّر لا إشارته
//   StatTile           رقم مضغوط داخل قسم
//   StatusBadge        حالة بأيقونة ونصّ — لا لون وحده
//   EmptyState         «لا بيانات» بسبب واقتراح
//   Icon               Material Symbols مخفيّة عن قارئ الشاشة
//
// ⚠️ كل نصّ من القاموس (t.dash)، وكل اتجاه منطقي (start/end/ms/me).
// ============================================================

export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`material-symbols-outlined ${className}`}>
      {name}
    </span>
  );
}

// ===== القسم =====

export function DashboardSection({
  id, title, hint, href, linkLabel, actions, children, className = "",
}: {
  id?: string;
  title: string;
  hint?: string;
  href?: string;
  linkLabel?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={`mb-8 scroll-mt-20 ${className}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-bold text-ink">{title}</h2>
          {hint && <p className="mt-0.5 text-[13px] text-ink-muted">{hint}</p>}
        </div>
        <div className="flex items-center gap-3">
          {actions}
          {href && linkLabel && (
            <Link href={href} className="dash-focus rounded text-sm font-bold text-brand-700 hover:underline">
              {linkLabel}
            </Link>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`dash-card p-4 sm:p-5 ${className}`}>{children}</div>;
}

export function CardTitle({ children, href, linkLabel }: { children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-sm font-bold text-ink">{children}</h3>
      {href && linkLabel && (
        <Link href={href} className="dash-focus shrink-0 rounded text-xs font-bold text-brand-700 hover:underline">
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

// ===== الاتجاه =====

// السهم يتبع إشارة الرقم، واللون يتبع الحكم (جيد/سيئ) — نصٌّ ملوّن لا حبّة:
// ارتفاع دورة البيع سهمٌ للأعلى بلون التراجع، ولا أخضر حيث لا حكم.
const TONE_TEXT: Record<Delta["tone"], string> = {
  good: "text-success-700",
  bad: "text-danger-700",
  neutral: "text-ink-secondary",
};

export function TrendIndicator({ delta, unit }: { delta: Delta | null; unit: Unit }) {
  const { locale, t } = getI18n();
  const d = t.dash.common;
  if (!delta || delta.change === null) {
    return <span className="text-xs text-ink-muted">{d.noPrevious}</span>;
  }
  if (delta.change === 0) {
    return <span className="text-xs font-medium text-ink-muted">{d.noChange}</span>;
  }
  const upArrow = delta.change > 0;
  // النسبة؛ أو «جديد» من صفر؛ أو فرق النقاط للنسب المئوية
  const label =
    unit === "pct"
      ? `${upArrow ? "+" : "−"}${fmtNumber(Math.abs(delta.change), locale, 1)} pp`
      : delta.pct === null
      ? d.newValue
      : `${upArrow ? "+" : "−"}${fmtNumber(Math.abs(delta.pct), locale, 1)}%`;
  const verdict = delta.tone === "good" ? d.better : delta.tone === "bad" ? d.worse : upArrow ? d.up : d.down;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${TONE_TEXT[delta.tone]}`}>
      <Icon name={upArrow ? "arrow_upward" : "arrow_downward"} className="text-[15px]" />
      <span dir="ltr">{label}</span>
      <span className="sr-only">{verdict}</span>
    </span>
  );
}

// ===== بطاقة المؤشّر =====

// ============================================================
// المؤشّرات — «لوحة قياس» واحدة لا بطاقاتٌ متشابهة (التصميم المعتمد):
// الخلايا تفصلها خطوط شعرية داخل إطارٍ واحد، وثلاث مقاسات تصنع
// الهرمية — والرقم البطل (hero) واحدٌ في اللوحة.
//
// الحدود: كل خليّة تحمل حدّها السفلي وحدّها النهائي، والشبكة مزاحةٌ
// بكسلاً تحت حافّة الإطار فتختفي الحدود الطرفية — فلا خانة رمادية
// إن قلّ عدد المؤشّرات عن الأعمدة (مشرفٌ بلا مؤشّرات المال).
// ============================================================

const STATUS_RING: Record<NonNullable<Kpi["status"]>, string> = {
  good: "bg-success-50 text-success-700",
  warning: "bg-warning-50 text-warning-700",
  danger: "bg-danger-50 text-danger-700",
  neutral: "bg-brand-50 text-brand-700",
};

type KpiSize = "xl" | "lg" | "md" | "sm";

export function KpiCard({ kpi, size = "md" }: { kpi: Kpi; size?: KpiSize }) {
  const { locale, t } = getI18n();
  const d = t.dash.common;
  const words = { currency: d.currency, days: d.days };
  // المبلغ: الرقم كبيراً والعملة صغيرةً بجانبه — فلا يُقصّ «245.8 مليون د.ع»
  const money = kpi.unit === "money" && kpi.value !== null;
  const value = money ? fmtCompact(kpi.value, locale) : fmtValue(kpi.value, kpi.unit, locale, words);
  const prev = kpi.delta?.previous ?? null;
  const valueClass = { xl: "text-kpi-xl", lg: "text-kpi-lg", md: "text-xl font-bold", sm: "text-[15px] font-bold" }[size];
  const iconTone = STATUS_RING[kpi.status ?? "neutral"];
  const tiny = size === "sm";

  const body = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        {!tiny && (
          <span className={`flex shrink-0 items-center justify-center rounded-md ${size === "md" ? "h-6 w-6" : "h-7 w-7"} ${iconTone}`}>
            <Icon name={kpi.icon} className={size === "md" ? "text-[16px]" : "text-[18px]"} />
          </span>
        )}
        <p className={`line-clamp-2 min-w-0 font-semibold leading-snug ${tiny ? "text-xs font-medium text-ink-muted" : size === "md" ? "text-[13px] text-ink-secondary" : "text-sm text-ink-secondary"}`}>
          {kpi.title}
        </p>
      </div>
      <p className={`${tiny ? "mt-1" : size === "md" ? "mt-2" : "mt-3"} flex min-w-0 flex-wrap items-baseline gap-x-1.5 ${kpi.status === "danger" ? "text-danger-700" : "text-ink"} ${valueClass}`}>
        {money && locale !== "ar" && <span className={`${size === "xl" ? "text-base" : "text-xs"} font-semibold text-ink-muted`}>{d.currency}</span>}
        <span className="min-w-0 truncate">{value}</span>
        {money && locale === "ar" && <span className={`${size === "xl" ? "text-base" : "text-xs"} font-semibold text-ink-muted`}>{d.currency}</span>}
      </p>
      <div className={`${tiny ? "mt-0.5" : "mt-2"} flex flex-wrap items-center gap-x-2 gap-y-0.5`}>
        {kpi.delta !== null && <TrendIndicator delta={kpi.delta} unit={kpi.unit} />}
        {kpi.delta !== null && prev !== null && (size === "xl" || size === "lg") && (
          <span className="num-tabular text-xs text-ink-muted">
            {fill(d.vsPrevious, { value: fmtValue(prev, kpi.unit, locale, words) })}
          </span>
        )}
        {kpi.subtitle && <span className="text-xs text-ink-muted">{kpi.subtitle}</span>}
      </div>
      {kpi.definition && <span className="sr-only">{`${d.definition}: ${kpi.definition}`}</span>}
    </>
  );

  const pad = tiny ? "px-4 py-3 sm:px-5" : size === "md" ? "px-4 py-4 sm:px-5" : "p-4 sm:p-5";
  const cls = `block h-full min-w-0 border-b border-e border-line ${tiny ? "bg-surface-subtle/70" : "bg-surface"} ${pad}`;
  return kpi.href ? (
    <Link
      href={kpi.href}
      title={kpi.definition}
      className={`${cls} transition-colors hover:bg-brand-50/60 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500`}
    >
      {body}
    </Link>
  ) : (
    <div title={kpi.definition} className={cls}>
      {body}
    </div>
  );
}

// عدد الأعمدة لا يتجاوز عدد المؤشّرات — فلا خانات فارغة في الصفّ
const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
};
const GRID_COLS_SMALL: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
};

export function KpiGrid({
  kpis, size = "md", cols = 4, label, hero = false, framed = true,
}: {
  kpis: Kpi[];
  size?: "lg" | "md" | "sm";
  cols?: 3 | 4 | 5 | 6;
  label?: string;
  /** المؤشّر الأول رقمٌ بطل (أكبر من غيره) — مرّة واحدة في اللوحة */
  hero?: boolean;
  /** false: بلا إطار — حين تجمع لوحةٌ واحدة عدّة طبقات (kpis.tsx) */
  framed?: boolean;
}) {
  const n = Math.max(1, Math.min(cols, kpis.length));
  const grid = (size === "lg" ? GRID_COLS : GRID_COLS_SMALL)[n];
  const inner = (
    <div role="list" aria-label={label} className={`-mb-px -me-px grid ${grid}`}>
      {kpis.map((k, i) => (
        <div role="listitem" key={k.key} className="min-w-0">
          <KpiCard kpi={k} size={hero && i === 0 ? "xl" : size} />
        </div>
      ))}
    </div>
  );
  // بلا إطار: طبقةٌ داخل لوحةٍ واحدة — خطٌّ شعري يفصلها عمّا تحتها إلا الأخيرة
  return framed
    ? <div className="overflow-hidden rounded-card border border-line bg-surface">{inner}</div>
    : <div className="overflow-hidden border-b border-line last:border-b-0">{inner}</div>;
}

// ===== رقم مضغوط =====

export function StatTile({
  label, value, unit = "count", href, tone = "neutral", hint,
}: {
  label: string;
  value: number | null;
  unit?: Unit;
  href?: string;
  tone?: "neutral" | "good" | "warning" | "danger";
  hint?: string;
}) {
  const { locale, t } = getI18n();
  const words = { currency: t.dash.common.currency, days: t.dash.common.days };
  const color = { neutral: "text-ink", good: "text-success-700", warning: "text-warning-700", danger: "text-danger-700" }[tone];
  // التسمية أولاً ثم الرقم — يُقرأ السؤال قبل جوابه (التصميم المعتمد)
  const inner = (
    <>
      <p className="truncate text-xs text-ink-muted">{label}</p>
      <p className={`num-tabular mt-1 truncate text-[15px] font-bold ${color}`}>
        {fmtValue(value, unit, locale, words)}
      </p>
    </>
  );
  const cls = "block rounded-lg border border-line bg-surface px-3.5 py-3";
  return href ? (
    <Link href={href} title={hint} className={`${cls} dash-focus transition hover:border-brand-200 hover:bg-brand-50/50`}>
      {inner}
    </Link>
  ) : (
    <div title={hint} className={cls}>{inner}</div>
  );
}

// ===== شارة الحالة =====

const BADGE: Record<string, { cls: string; icon: string }> = {
  good: { cls: "bg-success-50 text-success-700 ring-success-100", icon: "check_circle" },
  completed: { cls: "bg-success-50 text-success-700 ring-success-100", icon: "task_alt" },
  active: { cls: "bg-info-50 text-info-700 ring-info-100", icon: "radio_button_checked" },
  info: { cls: "bg-info-50 text-info-700 ring-info-100", icon: "info" },
  warning: { cls: "bg-warning-50 text-warning-700 ring-warning-100", icon: "schedule" },
  urgent: { cls: "bg-warning-50 text-warning-700 ring-warning-100", icon: "hourglass_bottom" },
  danger: { cls: "bg-danger-50 text-danger-700 ring-danger-100", icon: "error" },
  critical: { cls: "bg-danger-50 text-danger-700 ring-danger-100", icon: "error" },
  expired: { cls: "bg-surface-sunken text-ink-secondary ring-line", icon: "timer_off" },
  neutral: { cls: "bg-surface-sunken text-ink-secondary ring-line", icon: "remove" },
};

export function StatusBadge({ tone, label }: { tone: keyof typeof BADGE | string; label: string }) {
  const b = BADGE[tone] ?? BADGE.neutral;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${b.cls}`}>
      <Icon name={b.icon} className="text-[14px]" />
      {label}
    </span>
  );
}

// ===== الحالات الفارغة =====

export function EmptyState({ title, hint, icon = "inbox", compact = false }: { title: string; hint?: string; icon?: string; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-6" : "py-10"}`}>
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Icon name={icon} className="text-[22px]" />
      </span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-[13px] text-ink-secondary">{hint}</p>}
    </div>
  );
}

// ===== تنسيق سريع لمكوّنات الخادم =====

export function getFormat() {
  const { locale, t } = getI18n();
  const c = t.dash.common;
  return {
    locale,
    t,
    money: (n: number | null | undefined) => fmtMoney(n, locale, c.currency),
    num: (n: number | null | undefined, digits = 0) => fmtNumber(n, locale, digits),
    pct: (n: number | null | undefined) => fmtPct(n, locale),
    value: (n: number | null | undefined, unit: Unit) => fmtValue(n, unit, locale, { currency: c.currency, days: c.days }),
  };
}
