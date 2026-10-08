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
    <section id={id} aria-labelledby={headingId} className={`mb-6 scroll-mt-20 ${className}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-bold text-ink sm:text-lg">{title}</h2>
          {hint && <p className="text-xs text-ink-muted sm:text-sm">{hint}</p>}
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

const TONE_TEXT: Record<Delta["tone"], string> = {
  good: "text-success-700 bg-success-50",
  bad: "text-danger-700 bg-danger-50",
  neutral: "text-ink-secondary bg-surface-sunken",
};

export function TrendIndicator({ delta, unit }: { delta: Delta | null; unit: Unit }) {
  const { locale, t } = getI18n();
  const d = t.dash.common;
  if (!delta || delta.change === null) {
    return <span className="text-xs text-ink-muted">{d.noPrevious}</span>;
  }
  if (delta.change === 0) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_TEXT.neutral}`}>
        <Icon name="remove" className="text-sm" />
        {d.noChange}
      </span>
    );
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
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_TEXT[delta.tone]}`}>
      <Icon name={upArrow ? "arrow_upward" : "arrow_downward"} className="text-sm" />
      <span dir="ltr">{label}</span>
      <span className="sr-only">{verdict}</span>
    </span>
  );
}

// ===== بطاقة المؤشّر =====

const STATUS_RING: Record<NonNullable<Kpi["status"]>, string> = {
  good: "bg-success-50 text-success-700",
  warning: "bg-warning-50 text-warning-700",
  danger: "bg-danger-50 text-danger-700",
  neutral: "bg-brand-50 text-brand-700",
};

export function KpiCard({ kpi, size = "md" }: { kpi: Kpi; size?: "lg" | "md" | "sm" }) {
  const { locale, t } = getI18n();
  const d = t.dash.common;
  const words = { currency: d.currency, days: d.days };
  // المبلغ: الرقم كبيراً والعملة صغيرةً بجانبه — فلا يُقصّ «245.8 مليون د.ع» في البطاقة
  const money = kpi.unit === "money" && kpi.value !== null;
  const value = money ? fmtCompact(kpi.value, locale) : fmtValue(kpi.value, kpi.unit, locale, words);
  const prev = kpi.delta?.previous ?? null;
  const valueClass = size === "lg" ? "text-kpi-lg" : size === "md" ? "text-kpi-md" : "text-kpi-sm";
  const iconTone = STATUS_RING[kpi.status ?? "neutral"];

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-ink-secondary sm:text-[13px]">{kpi.title}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconTone}`}>
          <Icon name={kpi.icon} className="text-[18px]" />
        </span>
      </div>
      <p className={`mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1 text-ink ${valueClass}`}>
        <span className="min-w-0 truncate">{value}</span>
        {money && <span className="text-xs font-semibold text-ink-muted">{d.currency}</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {kpi.delta !== null && <TrendIndicator delta={kpi.delta} unit={kpi.unit} />}
        {kpi.delta !== null && prev !== null && size !== "sm" && (
          <span className="text-[11px] text-ink-muted">
            {fill(d.vsPrevious, { value: fmtValue(prev, kpi.unit, locale, words) })}
          </span>
        )}
        {kpi.subtitle && <span className="text-[11px] text-ink-muted">{kpi.subtitle}</span>}
      </div>
      {kpi.definition && <span className="sr-only">{`${d.definition}: ${kpi.definition}`}</span>}
    </>
  );

  const cls = `block min-w-[13.5rem] snap-start p-4 sm:min-w-0 ${size === "lg" ? "sm:p-5" : ""}`;
  return kpi.href ? (
    <Link href={kpi.href} title={kpi.definition} className={`dash-card-link ${cls}`}>
      {body}
    </Link>
  ) : (
    <div title={kpi.definition} className={`dash-card ${cls}`}>
      {body}
    </div>
  );
}

// على الجوّال: صفٌّ أفقي يُمرَّر بالإصبع (snap)؛ وعلى الأكبر: شبكة
export function KpiGrid({
  kpis, size = "md", cols = 4, label,
}: { kpis: Kpi[]; size?: "lg" | "md" | "sm"; cols?: 3 | 4 | 5 | 6; label?: string }) {
  const grid = {
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-3 lg:grid-cols-5",
    6: "sm:grid-cols-3 lg:grid-cols-6",
  }[cols];
  return (
    <div
      role="list"
      aria-label={label}
      className={`scrollbar-hide relative -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0 ${grid}`}
    >
      {kpis.map((k) => (
        <div role="listitem" key={k.key} className="contents">
          <KpiCard kpi={k} size={size} />
        </div>
      ))}
    </div>
  );
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
  const inner = (
    <>
      <p className={`truncate text-kpi-sm ${color}`}>
        {fmtValue(value, unit, locale, words)}
      </p>
      <p className="mt-0.5 text-xs text-ink-secondary">{label}</p>
    </>
  );
  const cls = "block rounded-xl border border-line bg-surface px-3 py-2.5";
  return href ? (
    <Link href={href} title={hint} className={`${cls} dash-focus transition hover:border-brand-200 hover:bg-surface-subtle`}>
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
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${b.cls}`}>
      <Icon name={b.icon} className="text-[14px]" />
      {label}
    </span>
  );
}

// ===== الحالات الفارغة =====

export function EmptyState({ title, hint, icon = "inbox", compact = false }: { title: string; hint?: string; icon?: string; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-6" : "py-10"}`}>
      <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
        <Icon name={icon} />
      </span>
      <p className="text-sm font-semibold text-ink-secondary">{title}</p>
      {hint && <p className="mt-0.5 max-w-sm text-xs text-ink-muted">{hint}</p>}
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
