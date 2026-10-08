import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/dashboard/format";
import { PORTAL_VIEWS, viewHref, type DashView, type ViewsInfo } from "@/lib/dashboard/views";
import { Icon } from "./ui";

// ============================================================
// ألسنة اللوحات — لمن له أكثر من «قبّعة»: مدير علاقات وموظف مبيعات،
// مشرف ومدير متابعة، والمدير بكل الأقسام. تظهر فقط إن كانت له أكثر من
// لوحة. «المالية» و«الموارد البشرية» رابطان إلى بوابتيهما.
// ============================================================

const ICON: Record<DashView, string> = {
  executive: "monitoring",
  team: "groups",
  sales: "person_pin",
  marketing: "campaign",
  followup: "fact_check",
  rm: "handshake",
  finance: "payments",
  hr: "badge",
  viewer: "visibility",
  broker: "apartment",
};

export function ViewTabs({
  info, current, keep,
}: { info: ViewsInfo; current: DashView; keep: Record<string, string | undefined> }) {
  const { t } = getI18n();
  if (info.views.length < 2) return null;
  const labels = t.dash.views;
  return (
    <nav aria-label={t.dash.persona.tabsLabel} className="scrollbar-hide relative -mx-4 mb-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-xl border border-line bg-surface p-1 shadow-card">
        {info.views.map((v) => {
          const on = v === current;
          const portal = !!PORTAL_VIEWS[v];
          return (
            <li key={v}>
              <Link
                href={viewHref(v, keep)}
                aria-current={on ? "page" : undefined}
                className={`dash-focus flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  on ? "bg-brand-600 text-white" : "text-ink-secondary hover:bg-surface-subtle hover:text-ink"
                }`}
              >
                <Icon name={ICON[v]} className="text-[18px]" />
                {labels[v]}
                {portal && <Icon name="open_in_new" className="text-[14px] opacity-60" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// تنبيه: المنصب يقترح دوراً أوسع من دور الحساب ← أقسامٌ ستظهر فارغة
export function MismatchBanner({ info, admin }: { info: ViewsInfo; admin: boolean }) {
  const { t } = getI18n();
  const p = t.dash.persona;
  const text = info.positionTitle && info.positionRoleName
    ? fill(p.mismatch, { position: info.positionTitle, role: info.positionRoleName })
    : p.mismatchShort;
  return (
    <div role="note" className="mb-4 flex items-start gap-2 rounded-card border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-700">
      <Icon name="manage_accounts" className="mt-0.5" />
      <div>
        <p className="font-bold">{p.mismatchTitle}</p>
        <p className="mt-0.5">{text}</p>
        {admin && (
          <Link href="/dashboard/settings/dashboards" className="dash-focus mt-1 inline-block rounded font-semibold underline">
            {t.dash.people.title}
          </Link>
        )}
      </div>
    </div>
  );
}
