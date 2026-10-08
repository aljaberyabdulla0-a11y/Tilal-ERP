import Link from "next/link";
import type { TaskCounts } from "@/lib/types";

// ============================================================
// قطع مركز العمل الثابتة (خادم): البطاقات، ألسنة العرض، رأس القسم.
// ============================================================

export type Kpi = { label: string; value: number | string; icon: string; tone: string; href?: string; hint?: string };

export function KpiGrid({ items }: { items: Kpi[] }) {
  return (
    <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="مؤشرات المهام">
      {items.map((k) => {
        const body = (
          <>
            <span aria-hidden="true" className={`material-symbols-outlined rounded-lg p-1.5 text-[20px] ${k.tone}`}>{k.icon}</span>
            <p className="mt-2 text-xs font-semibold text-ink-muted">{k.label}</p>
            <p className="num-tabular text-2xl font-bold text-ink" dir="ltr">{k.value}</p>
            {k.hint && <p className="mt-0.5 text-[11px] text-gray-400">{k.hint}</p>}
          </>
        );
        return k.href ? (
          <Link key={k.label} href={k.href} className="dash-card-link block p-3">{body}</Link>
        ) : (
          <div key={k.label} className="dash-card p-3">{body}</div>
        );
      })}
    </section>
  );
}

export function myKpis(c: TaskCounts["mine"], base = "/dashboard/tasks"): Kpi[] {
  return [
    { label: "متأخرة", value: c.late, icon: "warning", tone: "bg-red-50 text-red-700", href: `${base}?view=list&scope=mine&bucket=late` },
    { label: "اليوم", value: c.today, icon: "today", tone: "bg-brand-50 text-brand-700", href: `${base}?view=list&scope=mine&bucket=today` },
    { label: "قيد التنفيذ", value: c.in_progress, icon: "pending", tone: "bg-amber-50 text-amber-700", href: `${base}?view=list&scope=mine&status=قيد التنفيذ` },
    { label: "بانتظار", value: c.waiting, icon: "pause_circle", tone: "bg-gray-100 text-gray-700", href: `${base}?view=list&scope=mine&bucket=waiting`, hint: "تبعية أو موافقة أو توقّف" },
    { label: "بانتظار موافقتي", value: c.my_approvals, icon: "verified", tone: "bg-purple-50 text-purple-700", href: `${base}?view=list&scope=approvals` },
    { label: "أُنجزت اليوم", value: c.done_today, icon: "check_circle", tone: "bg-emerald-50 text-emerald-700" },
  ];
}

export function teamKpis(t: NonNullable<TaskCounts["team"]>, base = "/dashboard/tasks"): Kpi[] {
  const rate = t.due_30 ? Math.round((100 * t.done_due_30) / t.due_30) : null;
  const overdueRate = t.open ? Math.round((100 * t.late) / t.open) : null;
  const perEmp = t.people ? (t.open / t.people).toFixed(1) : "0";
  return [
    { label: "مفتوحة للفريق", value: t.open, icon: "groups", tone: "bg-brand-50 text-brand-700", href: `${base}?view=team` },
    { label: "نسبة الإنجاز (٣٠ يوماً)", value: rate == null ? "—" : `${rate}%`, icon: "trending_up", tone: "bg-emerald-50 text-emerald-700", hint: "المستحقّ في ٣٠ يوماً وأُنجز" },
    { label: "نسبة التأخير", value: overdueRate == null ? "—" : `${overdueRate}%`, icon: "schedule", tone: "bg-red-50 text-red-700", href: `${base}?view=list&scope=team&bucket=late` },
    { label: "مهام لكل موظف", value: perEmp, icon: "person", tone: "bg-gray-100 text-gray-700" },
    { label: "أُنجزت اليوم", value: t.done_today, icon: "task_alt", tone: "bg-emerald-50 text-emerald-700" },
    { label: "موافقات معلّقة", value: t.pending_approvals, icon: "verified", tone: "bg-purple-50 text-purple-700", href: `${base}?view=list&bucket=pending_approval` },
  ];
}

export type ViewTab = { key: string; label: string; icon: string };

export function ViewTabs({ tabs, current, basePath, keep = {}, param = "view" }: {
  tabs: ViewTab[]; current: string; basePath: string; keep?: Record<string, string>; param?: string;
}) {
  return (
    <nav aria-label="طرق العرض" className="scrollbar-hide relative -mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-xl border border-line bg-surface p-1 shadow-card">
        {tabs.map((t) => {
          const on = t.key === current;
          const q = new URLSearchParams({ ...keep, [param]: t.key }).toString();
          return (
            <li key={t.key}>
              <Link
                href={`${basePath}?${q}`}
                aria-current={on ? "page" : undefined}
                className={`dash-focus inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  on ? "bg-brand-600 text-white" : "text-ink-muted hover:bg-surface-subtle hover:text-ink"
                }`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{t.icon}</span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SectionTitle({ icon, title, count, tone = "text-ink", href }: {
  icon: string; title: string; count?: number; tone?: string; href?: string;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className={`flex items-center gap-2 text-base font-bold ${tone}`}>
        <span aria-hidden="true" className="material-symbols-outlined">{icon}</span>
        {title}
        {count != null && <span className="rounded-full bg-gray-100 px-2 text-xs text-gray-600" dir="ltr">{count}</span>}
      </h2>
      {href && count != null && count > 0 && (
        <Link href={href} className="text-sm font-medium text-brand-700 hover:underline">عرض الكل</Link>
      )}
    </div>
  );
}

export function NotReady() {
  return (
    <div role="alert" className="mb-6 rounded-2xl bg-amber-50 p-5 text-amber-800">
      لم يُفعَّل محرّك العمل V2 بعد في قاعدة البيانات — شغّل ملفات{" "}
      <b dir="ltr">sql/189 → 194</b> في Supabase بالترتيب.
    </div>
  );
}

export function EmptyState({ icon = "task_alt", text, action }: { icon?: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-8 text-center">
      <span aria-hidden="true" className="material-symbols-outlined text-[36px] text-gray-300">{icon}</span>
      <p className="text-sm text-ink-muted">{text}</p>
      {action}
    </div>
  );
}
