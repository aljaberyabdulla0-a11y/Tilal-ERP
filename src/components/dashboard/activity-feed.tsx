import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { tValue } from "@/lib/i18n/values";
import { fill, fmtMoney, fmtRelative } from "@/lib/dashboard/format";
import type { ActivityRow } from "@/lib/dashboard/data";
import { EmptyState, Icon } from "./ui";

// ============================================================
// سجلّ النشاط الموحّد — من dashboard_activity (sql/182).
//
// كل سطر: أيقونة + نوع + وصف + من + متى + المشروع + رابط الكيان.
// الوقت نسبي («قبل 12 دقيقة») ومطلقٌ في التلميح بتوقيت بغداد.
// ============================================================

const ICON: Record<string, string> = {
  lead_created: "person_add",
  qualified: "verified",
  assignment: "swap_horiz",
  activity: "call",
  won: "emoji_events",
  lost: "trending_down",
  reservation: "key",
  sale_completed: "handshake",
  reservation_cancelled: "event_busy",
  task_completed: "task_alt",
  lead_returned: "undo",
  payment: "payments",
  broker_request: "real_estate_agent",
  approval: "approval",
  inventory: "inventory_2",
};

const ACTIVITY_ICON: Record<string, string> = {
  "مكالمة": "call",
  "واتساب": "chat",
  "زيارة": "directions_walk",
  "اجتماع": "groups",
  "عرض سعر": "request_quote",
};

const TONE: Record<string, string> = {
  won: "bg-success-50 text-success-700",
  sale_completed: "bg-success-50 text-success-700",
  payment: "bg-success-50 text-success-700",
  lost: "bg-danger-50 text-danger-700",
  reservation_cancelled: "bg-danger-50 text-danger-700",
  reservation: "bg-info-50 text-info-700",
  broker_request: "bg-info-50 text-info-700",
};

export function activityHref(r: ActivityRow, opts: { broker?: boolean } = {}): string | null {
  if (!r.entity_id) return null;
  switch (r.entity) {
    case "client": return opts.broker ? `/dashboard/broker/leads/${r.entity_id}` : `/dashboard/clients/${r.entity_id}`;
    case "opportunity": return `/dashboard/crm/opportunities/${r.entity_id}`;
    case "reservation": return `/dashboard/reservations/${r.entity_id}`;
    case "task": return "/dashboard/tasks";
    case "invoice": return `/dashboard/invoices/${r.entity_id}`;
    case "broker_request": return opts.broker ? `/dashboard/broker/requests/${r.entity_id}` : `/dashboard/brokers/requests/${r.entity_id}`;
    case "approval": return "/dashboard/me/approvals";
    case "inventory_item": return `/dashboard/inventory/${r.entity_id}`;
    default: return null;
  }
}

export function ActivityFeed({ rows, broker = false }: { rows: ActivityRow[]; broker?: boolean }) {
  const { locale, t } = getI18n();
  const a = t.dash.activity;
  const kinds = a.kinds as Record<string, string>;
  if (rows.length === 0) return <EmptyState title={a.empty} icon="history" compact />;
  const now = new Date();

  return (
    <ol className="relative space-y-1">
      {rows.map((r, i) => {
        const href = activityHref(r, { broker });
        const icon = r.kind === "activity" ? ACTIVITY_ICON[r.subtype] ?? ICON.activity : ICON[r.kind] ?? "bolt";
        const kindLabel = kinds[r.kind] ?? r.kind;
        const sub = r.kind === "activity" || r.kind === "approval" || r.kind === "broker_request" || r.kind === "inventory"
          ? tValue(r.subtype, locale)
          : "";
        const what = [r.client_name, r.detail, r.project_name].filter(Boolean).join(" — ");
        const when = fmtRelative(r.at, locale, now);
        const abs = new Date(r.at).toLocaleString(locale === "ar" ? "ar-u-nu-latn" : "en-GB", { timeZone: "Asia/Baghdad" });

        const body = (
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${TONE[r.kind] ?? "bg-surface-sunken text-ink-secondary"}`}>
              <Icon name={icon} className="text-[17px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">
                <b className="font-semibold">{kindLabel}</b>
                {sub && <span className="text-ink-secondary"> · {sub}</span>}
                {r.amount !== null && Number(r.amount) > 0 && (
                  <span className="ms-1.5 text-xs font-semibold text-ink-secondary">
                    {fmtMoney(Number(r.amount), locale, t.dash.common.currency)}
                  </span>
                )}
              </p>
              {what && <p className="truncate text-xs text-ink-secondary"><bdi>{what}</bdi></p>}
              <p className="mt-0.5 text-[11px] text-ink-muted">
                {r.actor_name && <span>{a.by.split("{name}")[0]}<bdi>{r.actor_name}</bdi>{a.by.split("{name}")[1]} · </span>}
                <time dateTime={r.at} title={abs}>{when}</time>
              </p>
            </div>
          </div>
        );
        return (
          <li key={`${r.kind}-${r.entity_id ?? i}-${r.at}`}>
            {href ? (
              <Link href={href} className="dash-focus block rounded-lg p-2 transition hover:bg-surface-subtle">{body}</Link>
            ) : (
              <div className="p-2">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
