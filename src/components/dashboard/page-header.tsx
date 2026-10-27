import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { dayPart, fill, fmtLongDate } from "@/lib/dashboard/format";
import { Icon } from "./ui";
import MoreActions from "./more-actions";

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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <p className="mb-1 text-[13px] text-ink-muted">
          <time dateTime={now.toISOString()}>{fmtLongDate(now, locale)}</time>
        </p>
        <h1 className="truncate text-2xl font-bold text-ink sm:text-[1.75rem]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-secondary">{subtitle}</p>}
      </div>
      {actions.length > 0 && <QuickActions actions={actions} label={t.dash.sections.quickActions} />}
    </header>
  );
}

// الإجراءات السريعة (التصميم المعتمد): الأول أساسي، والثاني ثانوي،
// وما زاد يُجمع في قائمة «إجراءات» — فلا يتمدّد الرأس صفّاً من سبعة
// أزرار متساوية الوزن. الوجهات نفسها، لا شيء يُحذف.
export function QuickActions({ actions, label }: { actions: QuickAction[]; label: string }) {
  const { t } = getI18n();
  const visible = actions.slice(0, 2);
  const rest = actions.slice(2);
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      {visible.map((a, i) => (
        <Link
          key={`${a.href}-${i}`}
          href={a.href}
          className={
            (a.primary ?? i === 0)
              ? "dash-focus inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-brand-600 px-3.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              : "dash-focus inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 text-sm font-semibold text-ink transition hover:bg-surface-subtle"
          }
        >
          <Icon name={a.icon} className="text-[18px]" />
          {a.label}
        </Link>
      ))}
      <MoreActions actions={rest} label={t.dash.actions.more} />
    </nav>
  );
}
