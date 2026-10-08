"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/dashboard/format";

// ============================================================
// شريط التحكم — الفترة والمشروع والفريق والمصدر.
//
// • الرابط هو الحالة: كل اختيار يكتب ?range= أو ?from=&to= و?project=…
//   فيُشارَك الرابط ويُحفظ ويُفتح على نفس الشريحة.
// • على سطح المكتب صفٌّ واحد فوق المحتوى؛ وعلى الجوّال زرٌّ يفتح
//   «ورقة سفلية» بكل المُرشِّحات.
// • التحديث يُبقي الإطار: الصفحة الحالية تبقى ظاهرة بشفافية أقل حتى
//   تصل الجديدة — لا وميض ولا قفزة (useTransition).
//
// ⚠️ المُرشِّح هنا عرضٌ فقط: ما يصل إلى القاعدة يُقيَّد هناك بـRLS —
//    مشرفٌ يختار مشروع غيره في الرابط يحصل على صفر لا على بياناته.
// ============================================================

export type FilterOption = { id: string; name: string };

const PRESETS = ["today", "this_week", "this_month", "last_month", "this_quarter", "this_year"] as const;
type Preset = (typeof PRESETS)[number] | "custom";

export default function FilterBar({
  preset, from, to, project, team, source,
  projects = [], teams = [], sources = [],
  compareLabel, defaultPreset = "this_month",
  show = { project: true, team: false, source: false },
}: {
  preset: Preset;
  from: string;
  to: string;
  project: string | null;
  team: string | null;
  source: string | null;
  projects?: FilterOption[];
  teams?: FilterOption[];
  sources?: FilterOption[];
  compareLabel?: string | null;
  defaultPreset?: Preset;
  show?: { project?: boolean; team?: boolean; source?: boolean };
}) {
  const { t } = useI18n();
  const f = t.dash.filters;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [sheet, setSheet] = useState(false);
  const [custom, setCustom] = useState(preset === "custom");
  const [cFrom, setCFrom] = useState(from);
  const [cTo, setCTo] = useState(to);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCFrom(from);
    setCTo(to);
    setCustom(preset === "custom");
  }, [from, to, preset]);

  // الورقة السفلية: Esc يغلقها، والتركيز يدخلها عند الفتح
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    window.addEventListener("keydown", onKey);
    sheetRef.current?.querySelector<HTMLElement>("button, select, input")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  function go(patch: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    start(() => router.push(`${pathname}${s ? `?${s}` : ""}`, { scroll: false }));
  }

  function pickPreset(p: Preset) {
    if (p === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    setSheet(false);
    go({ range: p === defaultPreset ? null : p, from: null, to: null, grain: null });
  }

  function applyCustom() {
    if (!cFrom || !cTo) return;
    const [a, b] = cFrom <= cTo ? [cFrom, cTo] : [cTo, cFrom];
    go({ range: null, from: a, to: b, grain: null });
    setSheet(false);
  }

  const activeCount = [project, team, source].filter(Boolean).length + (preset !== defaultPreset ? 1 : 0);
  const presetLabel = (p: Preset) => f.presets[p];

  const selectCls =
    "dash-focus h-9 min-w-0 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink transition hover:border-line-strong";

  const controls = (stacked: boolean) => (
    <>
      <div role="radiogroup" aria-label={f.period} className={stacked ? "grid grid-cols-2 gap-2" : "flex flex-wrap gap-1 rounded-lg bg-surface-sunken p-1"}>
        {[...PRESETS, "custom" as const].map((p) => {
          const on = p === "custom" ? custom : !custom && preset === p;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pickPreset(p)}
              className={`dash-focus whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                on
                  ? "bg-surface text-brand-700 shadow-card ring-1 ring-line"
                  : stacked
                  ? "border border-line bg-surface text-ink-secondary"
                  : "text-ink-secondary hover:text-ink"
              }`}
            >
              {on && <span aria-hidden="true" className="material-symbols-outlined me-1 align-[-3px] text-[14px]">check</span>}
              {presetLabel(p)}
            </button>
          );
        })}
      </div>

      {custom && (
        <div className={stacked ? "grid grid-cols-2 gap-2" : "flex items-end gap-2"}>
          <label className="text-xs text-ink-secondary">
            <span className="mb-0.5 block">{f.from}</span>
            <input type="date" value={cFrom} max={cTo || undefined} onChange={(e) => setCFrom(e.target.value)} className={`${selectCls} w-full`} />
          </label>
          <label className="text-xs text-ink-secondary">
            <span className="mb-0.5 block">{f.to}</span>
            <input type="date" value={cTo} min={cFrom || undefined} onChange={(e) => setCTo(e.target.value)} className={`${selectCls} w-full`} />
          </label>
          <button type="button" onClick={applyCustom} className={`dash-focus h-9 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 ${stacked ? "col-span-2" : ""}`}>
            {f.apply}
          </button>
        </div>
      )}

      {show.project && projects.length > 0 && (
        <label className={stacked ? "block text-xs text-ink-secondary" : "contents"}>
          <span className={stacked ? "mb-0.5 block" : "sr-only"}>{f.project}</span>
          <select aria-label={f.project} value={project ?? ""} onChange={(e) => go({ project: e.target.value || null })} className={`${selectCls} ${stacked ? "w-full" : "max-w-[12rem]"}`}>
            <option value="">{f.allProjects}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      {show.team && teams.length > 0 && (
        <label className={stacked ? "block text-xs text-ink-secondary" : "contents"}>
          <span className={stacked ? "mb-0.5 block" : "sr-only"}>{f.team}</span>
          <select aria-label={f.team} value={team ?? ""} onChange={(e) => go({ team: e.target.value || null })} className={`${selectCls} ${stacked ? "w-full" : "max-w-[12rem]"}`}>
            <option value="">{f.allTeams}</option>
            {teams.map((p) => <option key={p.id} value={p.id}>{fill(f.teamOf, { name: p.name })}</option>)}
          </select>
        </label>
      )}
      {show.source && sources.length > 0 && (
        <label className={stacked ? "block text-xs text-ink-secondary" : "contents"}>
          <span className={stacked ? "mb-0.5 block" : "sr-only"}>{f.source}</span>
          <select aria-label={f.source} value={source ?? ""} onChange={(e) => go({ source: e.target.value || null })} className={`${selectCls} ${stacked ? "w-full" : "max-w-[11rem]"}`}>
            <option value="">{f.allSources}</option>
            {sources.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}

      {activeCount > 0 && (
        <button
          type="button"
          onClick={() => {
            setCustom(false);
            setSheet(false);
            start(() => router.push(pathname, { scroll: false }));
          }}
          className="dash-focus inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-semibold text-ink-secondary hover:bg-surface-sunken hover:text-ink"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">restart_alt</span>
          {f.reset}
        </button>
      )}
    </>
  );

  return (
    <div className="mb-5">
      {/* شريط التقدّم أثناء جلب الشريحة الجديدة */}
      <div aria-live="polite" className="sr-only">{pending ? f.updating : ""}</div>
      <div className={`fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-brand-500 rtl:origin-right transition-transform duration-500 ${pending ? "scale-x-75" : "scale-x-0"}`} aria-hidden="true" />

      {/* سطح المكتب */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">{controls(false)}</div>

      {/* الجوّال */}
      <div className="flex items-center gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setSheet(true)}
          aria-haspopup="dialog"
          aria-expanded={sheet}
          className="dash-focus inline-flex h-10 flex-1 items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink shadow-card"
        >
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-brand-700">tune</span>
            {presetLabel(custom ? "custom" : preset)}
          </span>
          {activeCount > 0 && <span className="rounded-full bg-brand-600 px-2 text-xs text-white">{activeCount}</span>}
        </button>
      </div>

      {compareLabel && <p className="mt-2 text-xs text-ink-muted">{compareLabel}</p>}

      {sheet && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={f.title}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setSheet(false)} />
          <div ref={sheetRef} className="absolute inset-x-0 bottom-0 max-h-[85vh] space-y-4 overflow-y-auto rounded-t-2xl bg-surface p-4 pb-8 shadow-sheet">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-ink">{f.title}</h2>
              <button type="button" onClick={() => setSheet(false)} aria-label={t.common.close} className="dash-focus flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-sunken">
                <span aria-hidden="true" className="material-symbols-outlined">close</span>
              </button>
            </div>
            {controls(true)}
          </div>
        </div>
      )}
    </div>
  );
}
