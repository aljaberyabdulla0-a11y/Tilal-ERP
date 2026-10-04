import Link from "next/link";
import { getCampaignsLite, getChannels, getMktProjects } from "@/lib/marketing";
import { PRESET_LABELS, withParams, type MktFilters } from "@/lib/marketing-filters";
import { ATTRIBUTION_MODELS, statusClass } from "@/lib/marketing-style";

// ============================================================
// قطع العرض المشتركة في قسم التسويق — للخادم (بلا "use client").
// ============================================================

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-brand-600">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-sm text-gray-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Tile({
  label, value, sub, tone, href,
}: { label: string; value: string; sub?: string; tone?: "brand" | "warn" | "bad"; href?: string }) {
  const color = tone === "brand" ? "text-brand-700" : tone === "warn" ? "text-amber-700" : tone === "bad" ? "text-red-700" : "text-gray-800";
  const body = (
    <>
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-sm text-gray-600">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-lg border border-gray-200 bg-white p-4 transition hover:border-brand-300">{body}</Link>
  ) : (
    <div className="rounded-lg border border-gray-200 bg-white p-4">{body}</div>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: string; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-gray-200 bg-white p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-semibold text-gray-800">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Badge({ children }: { children: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(children)}`}>{children}</span>;
}

export function Unavailable({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      الأرقام غير متاحة الآن — {error.includes("does not exist") || error.includes("Could not find")
        ? "هجرات التسويق (sql/121–126) لم تُطبَّق بعد على القاعدة."
        : error}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-gray-400">{children}</p>;
}

export async function MktFilterBar({
  basePath, f, showModel = false, showCampaign = true, extra = {},
}: {
  basePath: string; f: MktFilters; showModel?: boolean; showCampaign?: boolean; extra?: Record<string, string>;
}) {
  const [projects, campaigns, channels] = await Promise.all([getMktProjects(), getCampaignsLite(), getChannels()]);
  const all = { ...f.params, ...extra };
  const sel = "mt-1 rounded border border-gray-300 bg-white px-2 py-1.5";
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3 print:hidden">
      <div className="mb-2 flex flex-wrap gap-1 text-xs">
        {(Object.keys(PRESET_LABELS) as (keyof typeof PRESET_LABELS)[]).map((p) => (
          <Link
            key={p}
            href={withParams(basePath, all, { range: p === "month" ? null : p, from: null, to: null })}
            className={f.preset === p ? "rounded-full bg-brand-600 px-3 py-1 text-white" : "rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-brand-400"}
          >
            {PRESET_LABELS[p]}
          </Link>
        ))}
      </div>
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3 text-sm">
        {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label className="block">
          <span className="text-xs text-gray-500">من</span>
          <input type="date" name="from" defaultValue={f.from ?? ""} dir="ltr" className={sel} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">إلى</span>
          <input type="date" name="to" defaultValue={f.to ?? ""} dir="ltr" className={sel} />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">المشروع</span>
          <select name="project" defaultValue={f.project ?? ""} className={sel}>
            <option value="">كل المشاريع</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {showCampaign && (
          <label className="block">
            <span className="text-xs text-gray-500">الحملة</span>
            <select name="campaign" defaultValue={f.campaign ?? ""} className={`${sel} max-w-[14rem]`}>
              <option value="">كل الحملات</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-xs text-gray-500">القناة</span>
          <select name="channel" defaultValue={f.channel ?? ""} className={sel}>
            <option value="">كل القنوات</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {showModel && (
          <label className="block">
            <span className="text-xs text-gray-500">نموذج الإسناد</span>
            <select name="model" defaultValue={f.model} className={sel}>
              {Object.entries(ATTRIBUTION_MODELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        )}
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
          طبّق
        </button>
        {Object.keys(f.params).length > 0 && (
          <Link href={withParams(basePath, extra)} className="py-1.5 text-xs text-gray-500 hover:underline">مسح</Link>
        )}
      </form>
    </section>
  );
}
