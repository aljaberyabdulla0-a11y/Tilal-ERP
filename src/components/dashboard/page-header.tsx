import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { dayPart, fill, fmtLongDate } from "@/lib/dashboard/format";
import { Icon } from "./ui";

// ============================================================
// رأس اللوحة: التاريخ والتحية (بساعة بغداد) وسطر السياق، والإجراءات
// السريعة. مشترك بين كل اللوحات — كان مكرّراً في أربعة ملفات.
// ============================================================

export type QuickAction = { href: string; label: string; icon: string; primary?: boolean };

export function DashboardHeader({
  name, subtitle, actions = [],
}: {
  name?: string | null;
  subtitle?: string;
  actions?: QuickAction[];
}) {
  const { locale, t } = getI18n();
  const g = t.dash.greeting;
  const now = new Date();
  const greeting = g[dayPart(now)];
  const title = name ? fill(g.withName, { greeting, name }) : greeting;

  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="mb-1 text-xs font-semibold text-ink-muted">
          <time dateTime={now.toISOString()}>{fmtLongDate(now, locale)}</time>
        </p>
        <h1 className="truncate text-2xl font-bold text-ink sm:text-[1.75rem]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-secondary">{subtitle}</p>}
      </div>
      {actions.length > 0 && <QuickActions actions={actions} label={t.dash.sections.quickActions} />}
    </header>
  );
}

// الإجراءات السريعة: الأولى زرّ أساسي، والبقية ثانوية. على الجوّال
// صفٌّ أفقي يُمرَّر — لا قائمة طويلة تدفع المحتوى إلى الأسفل.
export function QuickActions({ actions, label }: { actions: QuickAction[]; label: string }) {
  return (
    <nav aria-label={label} className="scrollbar-hide relative -mx-4 flex max-w-full gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
      {actions.map((a, i) => (
        <Link
          key={`${a.href}-${i}`}
          href={a.href}
          className={
            (a.primary ?? i === 0)
              ? "dash-focus inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700"
              : "dash-focus inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink-secondary shadow-card transition hover:border-brand-200 hover:text-brand-700"
          }
        >
          <Icon name={a.icon} className="text-[18px]" />
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
