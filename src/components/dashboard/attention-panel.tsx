import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { fmtNumber } from "@/lib/dashboard/format";
import { Icon, StatusBadge } from "./ui";

// ============================================================
// «يحتاج انتباهك» — مركز التنبيهات.
//
// كل تنبيه: خطورة + عنوان + وصف + عدد + إجراء مقترح بزرّ يفتح الشاشة
// التي يُعالَج فيها. مرتّبة بالخطورة ثم بالعدد.
//
// يظهر فقط حين يوجد ما يستدعي التدخّل: لوحةٌ بلا تنبيهات لا تحتاج قسماً
// يقول «لا شيء» (نمط CrmAttention السابق). والصفر لا يُعرض تنبيهاً.
// ============================================================

export type Severity = "critical" | "high" | "medium" | "low";

export type AlertItem = {
  key: string;
  severity: Severity;
  icon: string;
  title: string;
  description: string;
  count: number;
  cta: string;
  href: string;
};

const ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const TONE: Record<Severity, string> = { critical: "critical", high: "warning", medium: "neutral", low: "neutral" };
// وعاء الأيقونة يحمل الخطورة: أحمر للحرج، كهرماني للمرتفع، محايد لما دونهما
const BOX: Record<Severity, string> = {
  critical: "bg-danger-50 text-danger-700",
  high: "bg-warning-50 text-warning-700",
  medium: "bg-surface-sunken text-ink-secondary",
  low: "bg-surface-sunken text-ink-muted",
};

export function sortAlerts(items: AlertItem[]): AlertItem[] {
  return items
    .filter((a) => a.count > 0)
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.count - a.count);
}

export function AttentionPanel({
  items, title, hint, children, limit = 8,
}: {
  items: AlertItem[];
  title: string;
  hint?: string;
  children?: React.ReactNode;
  limit?: number;
}) {
  const { locale, t } = getI18n();
  const shown = sortAlerts(items).slice(0, limit);
  if (shown.length === 0 && !children) return null;

  return (
    <section aria-labelledby="attention-title" className="mb-8">
      <div className="mb-3">
        <h2 id="attention-title" className="text-base font-bold text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-ink-muted">{hint}</p>}
      </div>
      {/* قائمةٌ واحدة مرتّبة بالخطورة (التصميم المعتمد) — لا شبكة بطاقات
          ملوّنة تتنافس على العين */}
      {shown.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {shown.map((a) => (
            <li key={a.key}>
              <Link href={a.href} className="dash-focus group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-subtle focus-visible:ring-inset">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${BOX[a.severity]}`}>
                  <Icon name={a.icon} className="text-[19px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    {a.title}
                    {(a.severity === "critical" || a.severity === "high") && (
                      <StatusBadge tone={TONE[a.severity]} label={t.dash.attention.severity[a.severity]} />
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-muted">{a.description}</span>
                </span>
                <span className="num-tabular min-w-[2ch] text-end text-lg font-bold text-ink" dir="ltr">{fmtNumber(a.count, locale)}</span>
                <span className="hidden shrink-0 rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-brand-700 group-hover:bg-brand-50 sm:inline">{a.cta}</span>
                <Icon name="chevron_left" className="shrink-0 text-[20px] text-ink-muted ltr:rotate-180" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {children}
    </section>
  );
}
