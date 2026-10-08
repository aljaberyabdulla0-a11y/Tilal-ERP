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
const TONE: Record<Severity, string> = { critical: "critical", high: "danger", medium: "warning", low: "info" };
const EDGE: Record<Severity, string> = {
  critical: "border-s-danger-600",
  high: "border-s-danger-600",
  medium: "border-s-warning-600",
  low: "border-s-info-600",
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
    <section aria-labelledby="attention-title" className="mb-6">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="attention-title" className="flex items-center gap-2 text-base font-bold text-ink sm:text-lg">
            <Icon name="notification_important" className="text-danger-600" />
            {title}
          </h2>
          {hint && <p className="text-xs text-ink-muted sm:text-sm">{hint}</p>}
        </div>
      </div>
      {shown.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((a) => (
            <li key={a.key}>
              <article className={`dash-card flex h-full flex-col border-s-4 p-4 ${EDGE[a.severity]}`}>
                <div className="flex items-start justify-between gap-2">
                  <StatusBadge tone={TONE[a.severity]} label={t.dash.attention.severity[a.severity]} />
                  <span className="text-kpi-md text-ink" dir="ltr">{fmtNumber(a.count, locale)}</span>
                </div>
                <h3 className="mt-2 flex items-center gap-1.5 text-sm font-bold text-ink">
                  <Icon name={a.icon} className="text-[18px] text-ink-secondary" />
                  {a.title}
                </h3>
                <p className="mt-1 flex-1 text-xs leading-5 text-ink-secondary">{a.description}</p>
                <Link
                  href={a.href}
                  className="dash-focus mt-3 inline-flex items-center gap-1 self-start rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-700"
                >
                  {a.cta}
                  <Icon name="arrow_forward" className="text-[16px] rtl:rotate-180" />
                </Link>
              </article>
            </li>
          ))}
        </ul>
      )}
      {children}
    </section>
  );
}
