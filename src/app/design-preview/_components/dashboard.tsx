"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/client";
import {
  dayPart, fill, fmtBucket, fmtCompact, fmtLongDate, fmtMoney, fmtNumber, fmtPct, fmtRelative, fmtShortDate,
} from "@/lib/dashboard/format";
import { rankProjects } from "@/lib/dashboard/kpi";
import type { Delta } from "@/lib/report-engine";
import {
  baghdadToday, buildDashboard, buildMoney, buildProjects, MOCK_ACTIVITY, MOCK_ATTENTION, MOCK_PROJECTS,
  MOCK_SOURCES, MOCK_TASKS, MOCK_TEAMS, MOCK_UNWORKED_DAYS, PRESETS, rangeFor,
  type ActivityKind, type Grain, type MockFilters, type MockProjectRow, type Preset,
} from "../_lib/mock-data";
import { usePreview, type DataState } from "./shell";
import {
  BarList, Funnel, Legend, Meter, MiniSkyline, PairedColumns, Skyline, SkylineTable, type SkyPoint,
} from "./charts";
import {
  Badge, Button, DeltaChip, EmptyState, ErrorState, Icon, INPUT, Menu, MockBadge, Pagination, Panel,
  SectionHeader, Segmented, Select, Skeleton, Tabs, Tooltip, useToast,
} from "./ui";

// ============================================================
// اللوحة التنفيذية في التصميم الجديد — نفس أسئلة اللوحة القائمة
// (_views/executive.tsx) بنفس مسمّياتها وتعريفاتها من القاموس:
//
//   كم بعنا وكم قبضنا ← ما ينتظر قراري ← كيف تسير المبيعات والمال
//   ← أي مشروع يتقدّم وأيّها يتعثّر ← ما حدث اليوم.
//
// الفرق في العرض لا في المعنى:
//   • المؤشّرات الأربع عشرة لوحةُ قياسٍ واحدة بثلاث طبقات تفصلها
//     خطوط شعرية — لا أربع عشرة بطاقة متشابهة.
//   • رقمٌ بطلٌ واحد (المبيعات) وما سواه أصغر منه بوضوح.
//   • المُرشِّحات شريطٌ واحد يقول ما الفعّال منها ويُزال بنقرة.
//
// ⚠️ كل رقم هنا من mock-data.ts. «حالة البيانات» في شريط المعاينة
//    تعرض التحميل والفراغ والخطأ على الأقسام كلّها.
// ============================================================

const DEFAULT_FILTERS: MockFilters = { preset: "this_month", custom: null, project: null, team: null, source: null };

function useFormat() {
  const { locale, t } = useI18n();
  const c = t.dash.common;
  return useMemo(() => ({
    money: (n: number | null) => fmtMoney(n, locale, c.currency),
    moneyFull: (n: number | null) => fmtMoney(n, locale, c.currency, { compact: false }),
    compact: (n: number | null) => fmtCompact(n, locale),
    count: (n: number | null) => fmtNumber(n, locale),
    pct: (n: number | null) => fmtPct(n, locale),
    days: (n: number | null) => (n === null ? "—" : `${fmtNumber(n, locale)} ${c.days}`),
    currency: c.currency,
  }), [locale, c.currency, c.days]);
}

export default function DashboardPreview() {
  const { locale, t } = useI18n();
  const { p, dataState, setDataState } = usePreview();
  const today = useMemo(() => baghdadToday(), []);
  const [filters, setFilters] = useState<MockFilters>(DEFAULT_FILTERS);
  const [grain, setGrain] = useState<Grain | null>(null);

  // تغيير المُرشِّح يُظهر تحميلاً قصيراً كما في اللوحة الحقيقية — لا
  // قفزة أرقام بلا إشارة إلى أنها تغيّرت
  const [refreshing, setRefreshing] = useState(false);
  const first = useRef(true);
  const fkey = JSON.stringify(filters);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setRefreshing(true);
    const id = setTimeout(() => setRefreshing(false), 450);
    return () => clearTimeout(id);
  }, [fkey]);

  const state: DataState = dataState === "ready" && refreshing ? "loading" : dataState;
  const data = useMemo(() => buildDashboard(filters, today, grain), [filters, today, grain]);
  const money = useMemo(() => buildMoney(today, filters.project), [today, filters.project]);
  const projects = useMemo(() => buildProjects(filters, today), [filters, today]);

  function update(next: Partial<MockFilters>) {
    if (next.preset !== undefined) setGrain(null);
    setFilters((f) => ({ ...f, ...next }));
  }
  function showYear() {
    setDataState("ready");
    update({ preset: "this_year" });
  }

  const range = rangeFor(filters.preset, today, filters.custom);
  const rangeText = filters.preset === "custom"
    ? `${fmtShortDate(range.from, locale)} – ${fmtShortDate(range.to, locale)}`
    : locale === "en" ? t.dash.filters.presets[filters.preset].toLowerCase() : t.dash.filters.presets[filters.preset];

  const now = useMemo(() => new Date(), []);
  const greeting = t.dash.greeting[dayPart(now)];

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="text-[13px] text-tp-ink-3">
            {greeting}{locale === "ar" ? "، " : ", "}<time dateTime={today}>{fmtLongDate(now, locale)}</time>
          </p>
          <h1 className="mt-1 text-2xl font-bold text-tp-ink sm:text-[28px] sm:leading-9">{p.executive}</h1>
          <p className="mt-1 max-w-2xl text-sm text-tp-ink-2">{fill(t.dash.subtitle.executive, { range: rangeText })}</p>
        </div>
        <QuickActions />
      </header>

      <FilterToolbar filters={filters} update={update} reset={() => { setFilters(DEFAULT_FILTERS); setGrain(null); }} today={today} prev={data.previous} />

      <div className="mt-6 space-y-8">
        <KpiBand data={data} state={state} onEmpty={showYear} />

        <div className="grid gap-6 lg:grid-cols-12 [&>*]:min-w-0">
          <section aria-labelledby="att-h" className="lg:col-span-8">
            <SectionHeader id="att-h" title={t.dash.sections.attention} hint={t.dash.sections.attentionHint} />
            <Attention state={state} project={filters.project} />
          </section>
          <section aria-labelledby="tasks-h" className="lg:col-span-4">
            <SectionHeader id="tasks-h" title={p.tasksToday} />
            <TodayTasks state={state} />
          </section>
        </div>

        <SalesSection data={data} state={state} grain={data.grain} setGrain={setGrain} onEmpty={showYear} />
        <FinanceSection money={money} state={state} onEmpty={showYear} />
        <ProjectsSection rows={projects} state={state} onEmpty={showYear} />

        <div className="grid gap-6 lg:grid-cols-12 [&>*]:min-w-0">
          <section aria-labelledby="act-h" className="lg:col-span-7">
            <SectionHeader id="act-h" title={t.dash.sections.activity} hint={t.dash.sections.activityHint} />
            <ActivityFeed state={state} />
          </section>
          <section aria-labelledby="src-h" className="lg:col-span-5">
            <SectionHeader id="src-h" title={t.dash.sections.leadSources} />
            <LeadSources leads={data.kpi.leads.value ?? 0} source={filters.source} state={state} onEmpty={showYear} />
          </section>
        </div>
      </div>
    </div>
  );
}

// ===== الإجراءات السريعة: واحد أساسي، وواحد ثانوي، والباقي في قائمة =====

function QuickActions() {
  const { t } = useI18n();
  const { p, openNewLead, unavailable } = usePreview();
  const a = t.dash.actions;
  const more = [
    { key: "task", label: a.newTask, icon: "add_task" },
    { key: "invoice", label: a.newInvoice, icon: "receipt_long" },
    { key: "expense", label: a.recordExpense, icon: "payments" },
    { key: "partners", label: a.partners, icon: "handshake" },
    { key: "announce", label: a.announce, icon: "campaign" },
  ];
  return (
    <div role="group" aria-label={t.dash.sections.quickActions} className="flex flex-wrap items-center gap-2">
      <Button variant="primary" icon="person_add" onClick={openNewLead}>{a.newLead}</Button>
      <Button variant="secondary" icon="key" onClick={() => unavailable(a.newReservation)}>{a.newReservation}</Button>
      <Menu
        label={p.moreActions}
        items={more}
        onPick={(k) => unavailable(more.find((m) => m.key === k)!.label)}
        trigger={(tr) => (
          <Button {...tr.props} variant="secondary" onClick={tr.toggle} aria-label={p.moreActions}>
            <Icon name="more_horiz" className="text-[20px]" />
            <span className="hidden sm:inline">{a.more}</span>
          </Button>
        )}
      />
    </div>
  );
}

// ===== شريط المُرشِّحات =====

function FilterToolbar({
  filters, update, reset, today, prev,
}: {
  filters: MockFilters; update: (f: Partial<MockFilters>) => void; reset: () => void; today: string; prev: { from: string; to: string };
}) {
  const { locale, t } = useI18n();
  const { p } = usePreview();
  const fl = t.dash.filters;
  const [draft, setDraft] = useState(() => rangeFor("this_month", today, null));
  const badRange = draft.from > draft.to;

  const chips: { key: string; label: string; clear: () => void }[] = [];
  const proj = MOCK_PROJECTS.find((x) => x.id === filters.project);
  const team = MOCK_TEAMS.find((x) => x.id === filters.team);
  const src = MOCK_SOURCES.find((x) => x.id === filters.source);
  if (proj) chips.push({ key: "p", label: proj.name[locale], clear: () => update({ project: null }) });
  if (team) chips.push({ key: "t", label: fill(fl.teamOf, { name: team.name[locale] }), clear: () => update({ team: null }) });
  if (src) chips.push({ key: "s", label: src.name[locale], clear: () => update({ source: null }) });
  const dirty = chips.length > 0 || filters.preset !== "this_month";

  return (
    <div className="mt-6 rounded-xl border border-tp-line bg-tp-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
        <div className="-mx-1 max-w-full overflow-x-auto px-1 py-0.5">
          <Segmented
            label={fl.period}
            value={filters.preset}
            onChange={(v: Preset) => {
              if (v === "custom") update({ preset: "custom", custom: badRange ? null : draft });
              else update({ preset: v, custom: null });
            }}
            options={[...PRESETS, "custom" as const].map((v) => ({ value: v, label: fl.presets[v] }))}
          />
        </div>
        {filters.preset === "custom" && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-tp-ink-3">
              <span className="mb-1 block">{fl.from}</span>
              <input type="date" value={draft.from} max={today} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={`${INPUT} h-8 w-[9.5rem]`} aria-invalid={badRange || undefined} />
            </label>
            <label className="text-xs text-tp-ink-3">
              <span className="mb-1 block">{fl.to}</span>
              <input type="date" value={draft.to} max={today} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className={`${INPUT} h-8 w-[9.5rem]`} aria-invalid={badRange || undefined} />
            </label>
            <Button size="sm" variant="primary" disabled={badRange} onClick={() => update({ custom: draft })}>{p.filters.customApply}</Button>
            {badRange && <p role="alert" className="w-full text-xs font-medium text-tp-neg">{p.filters.customInvalid}</p>}
          </div>
        )}
        <p className="ms-auto text-xs text-tp-ink-3">
          {fill(fl.comparedTo, { from: fmtShortDate(prev.from, locale), to: fmtShortDate(prev.to, locale) })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-tp-line px-3 py-2.5">
        <Icon name="filter_list" className="hidden text-[18px] text-tp-ink-3 sm:block" />
        <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-3">
          <Select aria-label={fl.project} value={filters.project ?? ""} onChange={(v) => update({ project: v || null })} className="sm:w-44">
            <option value="">{fl.allProjects}</option>
            {MOCK_PROJECTS.map((x) => <option key={x.id} value={x.id}>{x.name[locale]}</option>)}
          </Select>
          <Select aria-label={fl.team} value={filters.team ?? ""} onChange={(v) => update({ team: v || null })} className="sm:w-44">
            <option value="">{fl.allTeams}</option>
            {MOCK_TEAMS.map((x) => <option key={x.id} value={x.id}>{fill(fl.teamOf, { name: x.name[locale] })}</option>)}
          </Select>
          <Select aria-label={fl.source} value={filters.source ?? ""} onChange={(v) => update({ source: v || null })} className="sm:w-44">
            <option value="">{fl.allSources}</option>
            {MOCK_SOURCES.map((x) => <option key={x.id} value={x.id}>{x.name[locale]}</option>)}
          </Select>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:ms-2">
          {chips.length === 0 ? (
            <span className="text-xs text-tp-ink-3">{p.filters.activeNone}</span>
          ) : (
            <>
              <span className="text-xs font-semibold text-tp-ink-2">{fill(fl.active, { n: chips.length })}</span>
              {chips.map((c) => (
                <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-tp-mint-100 py-0.5 pe-1 ps-2.5 text-xs font-semibold text-tp-forest-700">
                  {c.label}
                  <button type="button" onClick={c.clear} aria-label={fill(p.filters.remove, { name: c.label })} className="tp-focus flex h-5 w-5 items-center justify-center rounded-full hover:bg-tp-forest-700/10">
                    <Icon name="close" className="text-[14px]" />
                  </button>
                </span>
              ))}
            </>
          )}
        </div>
        {dirty && <Button size="sm" variant="ghost" icon="restart_alt" onClick={reset}>{fl.reset}</Button>}
      </div>
    </div>
  );
}

// ===== حالات القسم =====

function StateGate({
  state, skeleton, onEmpty, children,
}: { state: DataState; skeleton: ReactNode; onEmpty: () => void; children: ReactNode }) {
  const { p, setDataState } = usePreview();
  if (state === "loading") return <div aria-busy="true" aria-label={p.loadingSection}>{skeleton}</div>;
  if (state === "error") {
    return (
      <ErrorState
        title={p.errorTitle}
        body={p.errorBody}
        action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => setDataState("ready")}>{p.retry}</Button>}
      />
    );
  }
  if (state === "empty") {
    return (
      <Panel>
        <EmptyState
          icon="event_busy"
          title={p.emptyTitle}
          body={p.emptyBody}
          action={<Button size="sm" variant="secondary" onClick={onEmpty}>{p.emptyAction}</Button>}
        />
      </Panel>
    );
  }
  return <>{children}</>;
}

// ===== لوحة المؤشّرات =====

type Data = ReturnType<typeof buildDashboard>;

function KpiBand({ data, state, onEmpty }: { data: Data; state: DataState; onEmpty: () => void }) {
  const { t } = useI18n();
  const { p } = usePreview();
  const f = useFormat();
  const k = t.dash.kpi;
  const d = data.kpi;
  const prevOf = (x: { delta: Delta | null }, fmt: (n: number | null) => string) =>
    x.delta && x.delta.previous !== null ? fill(p.vsPrev, { value: fmt(x.delta.previous) }) : p.noCompare;

  const skeleton = (
    <div className="overflow-hidden rounded-xl border border-tp-line bg-tp-surface p-5">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className={`${i === 0 ? "h-10 w-48" : "h-8 w-32"}`} />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <section aria-labelledby="kpi-h">
      <h2 id="kpi-h" className="sr-only">{t.dash.sections.primary}</h2>
      <StateGate state={state} skeleton={skeleton} onEmpty={onEmpty}>
        <div className="overflow-hidden rounded-xl border border-tp-line bg-tp-line">
          {/* الطبقة الأولى: أربعة أرقام تُقرأ في ثانيتين */}
          <div className="grid gap-px sm:grid-cols-3 xl:grid-cols-[1.55fr_1fr_1fr_1fr]">
            <div className="bg-tp-surface p-5 sm:col-span-3 xl:col-span-1">
              <KpiLabel icon="payments" label={k.sales} def={k.salesDef} />
              <div className="mt-3 flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <Money value={d.sales.value} size="hero" />
                  <DeltaLine delta={d.sales.delta} text={prevOf(d.sales, f.money)} />
                </div>
                <div className="hidden shrink-0 text-end sm:block">
                  <MiniSkyline values={data.weekly12} label={`${k.sales} — ${p.last12}`} />
                  <p className="mt-1 text-[11px] text-tp-ink-3">{p.last12}</p>
                </div>
              </div>
            </div>
            <Cell icon="account_balance_wallet" label={k.collected} def={k.collectedDef}>
              <Money value={d.collected.value} size="lg" />
              <DeltaLine delta={d.collected.delta} text={prevOf(d.collected, f.money)} />
            </Cell>
            <Cell icon="account_balance" label={k.netCash} def={k.netCashDef}>
              <Money value={d.net.value} size="lg" negative={(d.net.value ?? 0) < 0} />
              <DeltaLine delta={d.net.delta} text={prevOf(d.net, f.money)} />
            </Cell>
            <Cell icon="key" label={k.reservations} def={k.reservationsDef}>
              <Big>{f.count(d.reservations.value)}</Big>
              <DeltaLine delta={d.reservations.delta} text={prevOf(d.reservations, f.count)} />
            </Cell>
          </div>

          {/* الطبقة الثانية: المبيعات والمخزون */}
          <h3 className="sr-only">{t.dash.sections.secondary}</h3>
          <div className="mt-px grid grid-cols-2 gap-px lg:grid-cols-4">
            <Small icon="check_circle" label={k.wonDeals} def={k.wonDealsDef} value={f.count(d.won.value)} delta={d.won.delta} />
            <Small icon="apartment" label={k.unitsAvailable} def={k.unitsAvailableDef} value={f.count(d.available.value)}
              note={<span className="inline-flex items-center gap-1"><Badge tone="neutral">{p.snapshot}</Badge><span>{fill(k.unitsOf, { total: f.count(data.unitsTotal) })}</span></span>} />
            <Small icon="groups" label={k.activeLeads} def={k.activeLeadsDef} value={f.count(d.active.value)} delta={d.active.delta} />
            <Small icon="conversion_path" label={k.conversion} def={k.conversionDef} value={f.pct(d.conversion.value)} delta={d.conversion.delta} />
          </div>

          {/* الطبقة الثالثة: تشغيلية — أصغر وأهدأ */}
          <h3 className="sr-only">{t.dash.sections.operational}</h3>
          <div className="mt-px grid grid-cols-2 gap-px bg-tp-line sm:grid-cols-3 xl:grid-cols-6">
            <Tiny label={k.newLeads} def={k.newLeadsDef} value={f.count(d.leads.value)} delta={d.leads.delta} />
            <Tiny label={k.activities} def={k.activitiesDef} value={f.count(d.acts.value)} delta={d.acts.delta} />
            <Tiny label={k.avgDeal} def={k.avgDealDef} value={f.money(d.avg.value)} delta={d.avg.delta} />
            <Tiny label={k.salesCycle} def={k.salesCycleDef} value={f.days(d.cycle.value)} delta={d.cycle.delta} />
            <Tiny label={k.lostDeals} def={k.lostDealsDef} value={f.count(d.lost.value)} delta={d.lost.delta} />
            <Tiny label={k.weightedPipeline} def={k.weightedPipelineDef} value={f.money(d.wpipe.value)} delta={d.wpipe.delta} />
          </div>
        </div>
      </StateGate>
    </section>
  );
}

function KpiLabel({ icon, label, def, small = false }: { icon?: string; label: string; def?: string; small?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      {icon && (
        <span className={`flex shrink-0 items-center justify-center rounded-md bg-tp-mint-50 text-tp-forest-700 ${small ? "h-6 w-6" : "h-7 w-7"}`}>
          <Icon name={icon} className={small ? "text-[16px]" : "text-[18px]"} />
        </span>
      )}
      <span className={`line-clamp-2 min-w-0 font-semibold leading-snug text-tp-ink-2 ${small ? "text-[13px]" : "text-sm"}`}>{label}</span>
      {def && (
        <Tooltip label={def} wide side="below">
          <button type="button" aria-label={`${t.dash.common.definition}: ${def}`} className="tp-focus -m-1 flex rounded p-1 text-tp-ink-3 hover:text-tp-ink-2">
            <Icon name="info" className="text-[15px]" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function Money({ value, size, negative = false }: { value: number | null; size: "hero" | "lg"; negative?: boolean }) {
  const { locale } = useI18n();
  const f = useFormat();
  const num = <span>{fmtCompact(value, locale)}</span>;
  const unit = <span className={`font-semibold text-tp-ink-3 ${size === "hero" ? "text-base" : "text-sm"}`}>{f.currency}</span>;
  return (
    <p
      title={f.moneyFull(value)}
      className={`flex items-baseline gap-1.5 font-bold ${negative ? "text-tp-neg" : "text-tp-ink"} ${size === "hero" ? "text-[40px] leading-[44px]" : "text-[26px] leading-8"}`}
    >
      {locale === "ar" ? <>{num}{unit}</> : <>{unit}{num}</>}
    </p>
  );
}

function Big({ children }: { children: ReactNode }) {
  return <p className="text-[26px] font-bold leading-8 text-tp-ink">{children}</p>;
}

function DeltaLine({ delta, text }: { delta: Delta | null; text: string }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-tp-ink-3">
      <DeltaChip delta={delta} />
      <span className="tp-tabular">{text}</span>
    </p>
  );
}

function Cell({ icon, label, def, children }: { icon: string; label: string; def: string; children: ReactNode }) {
  return (
    <div className="bg-tp-surface p-5">
      <KpiLabel icon={icon} label={label} def={def} />
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Small({ icon, label, def, value, delta, note }: { icon: string; label: string; def: string; value: string; delta?: Delta | null; note?: ReactNode }) {
  return (
    <div className="bg-tp-surface px-5 py-4">
      <KpiLabel icon={icon} label={label} def={def} small />
      <p className="mt-2 text-xl font-bold text-tp-ink">{value}</p>
      <div className="mt-1 text-xs text-tp-ink-3">{note ?? <DeltaChip delta={delta ?? null} compact />}</div>
    </div>
  );
}

function Tiny({ label, def, value, delta }: { label: string; def: string; value: string; delta: Delta | null }) {
  return (
    <div className="bg-tp-paper/70 px-5 py-3">
      <p className="truncate text-xs text-tp-ink-3" title={def}>{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[15px] font-bold text-tp-ink">{value}</span>
        <DeltaChip delta={delta} compact />
      </div>
    </div>
  );
}

// ===== يحتاج انتباهك =====

const SEV: Record<string, { tone: "neg" | "warn" | "neutral"; box: string }> = {
  critical: { tone: "neg", box: "bg-tp-neg-bg text-tp-neg" },
  high: { tone: "warn", box: "bg-tp-warn-bg text-tp-warn" },
  medium: { tone: "neutral", box: "bg-tp-sunken text-tp-ink-2" },
  low: { tone: "neutral", box: "bg-tp-sunken text-tp-ink-3" },
};

function Attention({ state, project }: { state: DataState; project: string | null }) {
  const { t } = useI18n();
  const { p, unavailable } = usePreview();
  const a = t.dash.attention;
  const [all, setAll] = useState(false);
  const k = project ? MOCK_PROJECTS.find((x) => x.id === project)?.weight ?? 1 : 1;
  const items = MOCK_ATTENTION
    .map((x) => ({ ...x, count: Math.round(x.count * (project ? Math.min(1, k * 2.4) : 1)) }))
    .filter((x) => x.count > 0);
  const shown = all ? items : items.slice(0, 5);

  const skeleton = (
    <Panel className="divide-y divide-tp-line">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="h-9 w-9" />
          <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-48" /><Skeleton className="h-3 w-72 max-w-full" /></div>
          <Skeleton className="h-6 w-8" />
        </div>
      ))}
    </Panel>
  );

  return (
    <StateGate state={state === "empty" ? "ready" : state} skeleton={skeleton} onEmpty={() => {}}>
      {items.length === 0 || state === "empty" ? (
        <Panel><EmptyState icon="task_alt" title={a.clear} /></Panel>
      ) : (
        <Panel>
          <ul className="divide-y divide-tp-line">
            {shown.map((x) => {
              const it = a.items[x.key];
              const sev = SEV[x.severity];
              return (
                <li key={x.key} className="flex items-center gap-3 px-4 py-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${sev.box}`}>
                    <Icon name={x.icon} className="text-[19px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-tp-ink">
                      {it.title}
                      {(x.severity === "critical" || x.severity === "high") && <Badge tone={sev.tone}>{a.severity[x.severity]}</Badge>}
                    </p>
                    <p className="mt-0.5 truncate text-[13px] text-tp-ink-3">{fill(it.desc, { days: MOCK_UNWORKED_DAYS })}</p>
                  </div>
                  <span className="tp-tabular min-w-[2ch] text-end text-lg font-bold text-tp-ink">{x.count}</span>
                  <Button size="sm" variant="ghost" onClick={() => unavailable(it.cta)} className="hidden sm:inline-flex">
                    {it.cta}
                  </Button>
                  <button type="button" onClick={() => unavailable(it.cta)} aria-label={it.cta} className="tp-focus rounded p-1 text-tp-ink-3 sm:hidden">
                    <Icon name="chevron_left" className="text-[20px] ltr:rotate-180" />
                  </button>
                </li>
              );
            })}
          </ul>
          {items.length > 5 && (
            <div className="border-t border-tp-line px-4 py-2">
              <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="tp-focus rounded text-[13px] font-semibold text-tp-forest-700 hover:underline">
                {all ? p.attentionLess : fill(p.attentionAll, { n: items.length })}
              </button>
            </div>
          )}
        </Panel>
      )}
    </StateGate>
  );
}

// ===== مهام اليوم =====

function TodayTasks({ state }: { state: DataState }) {
  const { locale } = useI18n();
  const { p } = usePreview();
  const toast = useToast();
  const [done, setDone] = useState<Set<string>>(new Set());
  const skeleton = (
    <Panel className="space-y-4 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</Panel>
  );
  return (
    <StateGate state={state === "empty" ? "ready" : state} skeleton={skeleton} onEmpty={() => {}}>
      <Panel>
        <ul className="divide-y divide-tp-line">
          {MOCK_TASKS.map((tk) => {
            const on = done.has(tk.id);
            return (
              <li key={tk.id}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-tp-paper/70">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      setDone((s) => { const n = new Set(s); if (n.has(tk.id)) n.delete(tk.id); else n.add(tk.id); return n; });
                      toast({ tone: "info", message: p.taskLocal });
                    }}
                    className="tp-focus mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-tp-line-strong accent-[rgb(46_90_64)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${on ? "text-tp-ink-3 line-through" : "font-medium text-tp-ink"}`}>{tk.title[locale]}</span>
                    <span className={`mt-0.5 block text-xs ${tk.late && !on ? "font-semibold text-tp-neg" : "text-tp-ink-3"}`}>
                      {on ? p.taskDone : tk.due[locale]}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </Panel>
    </StateGate>
  );
}

// ===== أداء المبيعات =====

function SalesSection({
  data, state, grain, setGrain, onEmpty,
}: { data: Data; state: DataState; grain: Grain; setGrain: (g: Grain) => void; onEmpty: () => void }) {
  const { locale, t } = useI18n();
  const { p } = usePreview();
  const f = useFormat();
  const s = t.dash.sections;
  const k = t.dash.kpi;
  const [view, setView] = useState<"chart" | "table">("chart");
  const points: SkyPoint[] = data.trend.map((b) => ({ key: b.key, label: fmtBucket(b.key, grain, locale), current: b.current, previous: b.previous }));

  return (
    <section aria-labelledby="sales-h">
      <SectionHeader
        id="sales-h"
        title={s.sales}
        hint={s.salesHint}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented size="sm" label={s.trend} value={grain} onChange={setGrain}
              options={(["day", "week", "month"] as const).map((g) => ({ value: g, label: t.dash.charts.grain[g] }))} />
            <Segmented size="sm" label={t.dash.common.showTable} value={view} onChange={setView}
              options={[{ value: "chart", label: p.chartView }, { value: "table", label: p.chartTable }]} />
          </div>
        }
      />
      <StateGate
        state={state}
        onEmpty={onEmpty}
        skeleton={<div className="grid gap-6 lg:grid-cols-12 [&>*]:min-w-0"><Skeleton className="h-[22rem] lg:col-span-8" /><Skeleton className="h-[22rem] lg:col-span-4" /></div>}
      >
        <div className="grid gap-6 lg:grid-cols-12 [&>*]:min-w-0">
          <Panel className="p-5 lg:col-span-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-tp-ink">{k.sales}</h3>
              <Legend items={[
                { label: t.dash.common.current, className: "bg-tp-viz1" },
                { label: t.dash.common.previous, className: "bg-tp-ink-2", line: true },
              ]} />
            </div>
            <div className="mt-2">
              {view === "chart"
                ? <Skyline key={`${data.range.from}${data.range.to}${grain}`} points={points} title={k.sales} fmt={f.money} axisFmt={f.compact} />
                : <div className="mt-3"><SkylineTable points={points} fmt={f.money} /></div>}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-tp-line bg-tp-line sm:grid-cols-4">
              <Stat label={k.wonDeals} value={f.count(data.kpi.won.value)} />
              <Stat label={k.salesCompleted} value={f.count(data.completed)} />
              <Stat label={k.avgDeal} value={f.money(data.kpi.avg.value)} />
              <Stat label={k.salesCycle} value={f.days(data.kpi.cycle.value)} />
            </div>
          </Panel>
          <Panel className="p-5 lg:col-span-4">
            <h3 className="text-sm font-bold text-tp-ink">{s.funnel}</h3>
            <p className="mb-4 mt-0.5 text-xs text-tp-ink-3">{s.funnelHint}</p>
            <Funnel
              steps={data.funnel.map((x) => ({ key: x.key, label: x.label[locale], value: x.value, conversion: x.conversion }))}
              fmtCount={f.count}
              fmtPct={f.pct}
            />
          </Panel>
        </div>
      </StateGate>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "neg" }) {
  return (
    <div className="bg-tp-surface px-4 py-3">
      <p className="truncate text-xs text-tp-ink-3">{label}</p>
      <p className={`mt-1 text-[15px] font-bold ${tone === "warn" ? "text-tp-warn" : tone === "neg" ? "text-tp-neg" : "text-tp-ink"}`}>{value}</p>
    </div>
  );
}

// ===== الإيرادات والنقد =====

function FinanceSection({ money, state, onEmpty }: { money: ReturnType<typeof buildMoney>; state: DataState; onEmpty: () => void }) {
  const { locale, t } = useI18n();
  const { p } = usePreview();
  const f = useFormat();
  const s = t.dash.sections;
  const k = t.dash.kpi;
  return (
    <section aria-labelledby="fin-h">
      <SectionHeader
        id="fin-h"
        title={s.finance}
        hint={s.financeHint}
        action={<Badge tone="neutral" icon="schedule">{p.snapshot}</Badge>}
      />
      <StateGate state={state} onEmpty={onEmpty} skeleton={<div className="space-y-6"><Skeleton className="h-20" /><Skeleton className="h-72" /></div>}>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-tp-line bg-tp-line md:grid-cols-3 xl:grid-cols-6">
          <Stat label={k.cash} value={f.money(money.cash)} tone={money.cash < 0 ? "neg" : undefined} />
          <Stat label={k.monthIncome} value={f.money(money.monthIncome)} />
          <Stat label={k.monthExpense} value={f.money(money.monthExpense)} />
          <Stat label={k.payrollDue} value={f.money(money.payrollDue)} tone={money.payrollDue > 0 ? "warn" : undefined} />
          <Stat label={k.partnerDue} value={f.money(money.partnerDue)} />
          <Stat label={k.developerDue} value={f.money(money.developerDue)} />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-12 [&>*]:min-w-0">
          <Panel className="p-5 lg:col-span-8">
            <h3 className="mb-3 text-sm font-bold text-tp-ink">{s.incomeVsExpense}</h3>
            <PairedColumns
              title={s.incomeVsExpense}
              aLabel={t.dash.charts.income}
              bLabel={t.dash.charts.expense}
              fmt={f.money}
              axisFmt={f.compact}
              groups={money.months.map((m) => ({ key: m.key, label: fmtBucket(m.key, "month", locale), a: m.income, b: m.expense }))}
            />
          </Panel>
          <Panel className="p-5 lg:col-span-4">
            <h3 className="mb-4 text-sm font-bold text-tp-ink">{s.expenseByCategory}</h3>
            <BarList barClass="bg-tp-viz2" fmt={f.money} rows={money.byCategory.map((c) => ({ key: c.label.en, label: c.label[locale], value: c.amount }))} />
          </Panel>
        </div>
      </StateGate>
    </section>
  );
}

// ===== أداء المشاريع: جدول يُرتَّب ويُرقَّم، وبطاقات على الجوّال =====

type SortKey = "name" | "total" | "available" | "reserved" | "sold" | "sellThrough" | "revenue" | "reservations";
const PAGE_SIZE = 4;

function ProjectsSection({ rows, state, onEmpty }: { rows: MockProjectRow[]; state: DataState; onEmpty: () => void }) {
  const { locale, t } = useI18n();
  const { p } = usePreview();
  const f = useFormat();
  const tb = t.dash.table;
  const st = t.dash.status;
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "revenue", dir: "desc" });
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [rows.length, sort]);

  const { top, attention } = rankProjects(rows.map((r) => ({ id: r.id, sellThrough: r.sellThrough, revenue: r.revenue, available: r.available })));
  const sorted = [...rows].sort((a, b) => {
    const va = sort.key === "name" ? a.name[locale] : a[sort.key];
    const vb = sort.key === "name" ? b.name[locale] : b[sort.key];
    const c = typeof va === "string" ? va.localeCompare(vb as string, locale) : (va as number) - (vb as number);
    return sort.dir === "asc" ? c : -c;
  });
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const slice = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const cols: { key: SortKey; label: string; num: boolean }[] = [
    { key: "name", label: tb.project, num: false },
    { key: "total", label: tb.units, num: true },
    { key: "available", label: tb.available, num: true },
    { key: "reserved", label: tb.reserved, num: true },
    { key: "sold", label: tb.sold, num: true },
    { key: "sellThrough", label: tb.sellThrough, num: false },
    { key: "revenue", label: tb.revenue, num: true },
    { key: "reservations", label: tb.reservations, num: true },
  ];
  const badge = (id: string) =>
    top.has(id) ? <Badge tone="pos" icon="trending_up">{st.top}</Badge>
    : attention.has(id) ? <Badge tone="warn" icon="priority_high">{st.needsAttention}</Badge>
    : null;

  return (
    <section aria-labelledby="proj-h">
      <SectionHeader id="proj-h" title={t.dash.sections.projects} hint={t.dash.sections.projectsHint} />
      <StateGate state={state} onEmpty={onEmpty} skeleton={<Panel className="space-y-3 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9" />)}</Panel>}>
        <Panel className="overflow-hidden">
          {/* سطح المكتب والجهاز اللوحي: جدول */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-[13px]">
              <thead className="bg-tp-paper text-xs text-tp-ink-3">
                <tr>
                  {cols.map((c) => {
                    const on = sort.key === c.key;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                        className={`whitespace-nowrap px-4 py-2.5 font-semibold ${c.num ? "text-end" : "text-start"}`}
                      >
                        <button
                          type="button"
                          onClick={() => setSort({ key: c.key, dir: on && sort.dir === "desc" ? "asc" : "desc" })}
                          aria-label={fill(p.sortBy, { col: c.label })}
                          className={`tp-focus inline-flex items-center gap-1 rounded hover:text-tp-ink ${on ? "text-tp-ink" : ""}`}
                        >
                          {c.label}
                          <Icon name={on ? (sort.dir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"} className={`text-[14px] ${on ? "" : "opacity-50"}`} />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-tp-line">
                {slice.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-tp-paper/60">
                    <th scope="row" className="px-4 py-3 text-start">
                      <span className="flex flex-wrap items-center gap-2 font-semibold text-tp-ink">{r.name[locale]}{badge(r.id)}</span>
                    </th>
                    <td className="tp-tabular px-4 py-3 text-end text-tp-ink-2">{f.count(r.total)}</td>
                    <td className="tp-tabular px-4 py-3 text-end font-semibold text-tp-ink">{f.count(r.available)}</td>
                    <td className="tp-tabular px-4 py-3 text-end text-tp-ink-2">{f.count(r.reserved)}</td>
                    <td className="tp-tabular px-4 py-3 text-end text-tp-ink-2">{f.count(r.sold)}</td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-[8rem] items-center gap-2">
                        <Meter value={r.sellThrough} label={`${p.sellThrough} ${r.name[locale]}`} />
                        <span className="tp-tabular w-12 shrink-0 text-end text-xs font-semibold text-tp-ink">{f.pct(r.sellThrough)}</span>
                      </div>
                    </td>
                    <td className="tp-tabular whitespace-nowrap px-4 py-3 text-end font-semibold text-tp-ink">{f.money(r.revenue)}</td>
                    <td className="tp-tabular px-4 py-3 text-end text-tp-ink-2">{f.count(r.reservations)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* الجوّال: بطاقة لكل مشروع — لا تمرير أفقي */}
          <ul className="divide-y divide-tp-line md:hidden">
            {slice.map((r) => (
              <li key={r.id} className="px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-tp-ink">{r.name[locale]}</p>
                  {badge(r.id)}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Meter value={r.sellThrough} label={`${p.sellThrough} ${r.name[locale]}`} />
                  <span className="tp-tabular shrink-0 text-xs font-semibold text-tp-ink">{f.pct(r.sellThrough)}</span>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-tp-ink-3">{tb.available}</dt><dd className="tp-tabular mt-0.5 font-semibold text-tp-ink">{f.count(r.available)}</dd></div>
                  <div><dt className="text-tp-ink-3">{tb.reserved}</dt><dd className="tp-tabular mt-0.5 font-semibold text-tp-ink">{f.count(r.reserved)}</dd></div>
                  <div><dt className="text-tp-ink-3">{tb.revenue}</dt><dd className="tp-tabular mt-0.5 font-semibold text-tp-ink">{f.money(r.revenue)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>

          <Pagination
            page={page}
            pages={pages}
            onPage={setPage}
            summary={fill(p.perPage, { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, sorted.length), total: sorted.length })}
            labels={{ prev: tb.prev, next: tb.next, page: fill(p.page, { n: page, total: pages }) }}
          />
        </Panel>
      </StateGate>
    </section>
  );
}

// ===== آخر النشاطات — بألسنة تعمل =====

const KIND_ICON: Record<ActivityKind, string> = {
  lead_created: "person_add", won: "workspace_premium", reservation: "key", payment: "payments",
  activity: "call", broker_request: "real_estate_agent", task_completed: "task_alt", lost: "do_not_disturb_on",
};
const KIND_GROUP: Record<ActivityKind, "sales" | "crm" | "ops"> = {
  won: "sales", reservation: "sales", payment: "sales", broker_request: "sales",
  lead_created: "crm", activity: "crm", lost: "crm", task_completed: "ops",
};

function ActivityFeed({ state }: { state: DataState }) {
  const { locale, t } = useI18n();
  const f = useFormat();
  const [tab, setTab] = useState<"all" | "sales" | "crm" | "ops">("all");
  const now = useMemo(() => new Date(), []);
  const labels = locale === "en"
    ? { sales: "Sales and money", crm: "CRM", ops: "Operations" }
    : { sales: "المبيعات والمال", crm: "الـCRM", ops: "التشغيل" };
  const rows = MOCK_ACTIVITY.filter((r) => tab === "all" || KIND_GROUP[r.kind] === tab);
  const count = (g: "sales" | "crm" | "ops") => MOCK_ACTIVITY.filter((r) => KIND_GROUP[r.kind] === g).length;

  return (
    <StateGate state={state === "empty" ? "ready" : state} onEmpty={() => {}} skeleton={<Panel className="space-y-3 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-11" />)}</Panel>}>
      <Panel>
        <div className="px-4 pt-2">
          <Tabs
            label={t.dash.sections.activity}
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "all", label: t.dash.activity.filterAll, count: MOCK_ACTIVITY.length },
              { value: "sales", label: labels.sales, count: count("sales") },
              { value: "crm", label: labels.crm, count: count("crm") },
              { value: "ops", label: labels.ops, count: count("ops") },
            ]}
          />
        </div>
        <ol role="tabpanel" className="divide-y divide-tp-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3">
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${r.kind === "won" ? "bg-tp-mint-100 text-tp-forest-700" : r.kind === "lost" ? "bg-tp-neg-bg text-tp-neg" : "bg-tp-sunken text-tp-ink-2"}`}>
                <Icon name={KIND_ICON[r.kind]} className="text-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-tp-ink">
                  <span className="font-semibold">{t.dash.activity.kinds[r.kind]}</span>
                  <span className="text-tp-ink-2">: {r.subject[locale]}</span>
                </p>
                <p className="mt-0.5 text-xs text-tp-ink-3">
                  {fill(t.dash.activity.by, { name: r.by[locale] })}{locale === "ar" ? "، " : ", "}{fmtRelative(new Date(now.getTime() - r.minutesAgo * 60000).toISOString(), locale, now)}
                </p>
              </div>
              {r.amount !== undefined && <span className="tp-tabular shrink-0 text-[13px] font-semibold text-tp-ink">{f.money(r.amount)}</span>}
            </li>
          ))}
        </ol>
      </Panel>
    </StateGate>
  );
}

// ===== الليدات حسب المصدر =====

function LeadSources({ leads, source, state, onEmpty }: { leads: number; source: string | null; state: DataState; onEmpty: () => void }) {
  const { locale } = useI18n();
  const f = useFormat();
  const total = MOCK_SOURCES.reduce((s, x) => s + x.weight, 0);
  const rows = MOCK_SOURCES
    .filter((x) => !source || x.id === source)
    .map((x) => ({ key: x.id, label: x.name[locale], value: Math.round(source ? leads : (leads * x.weight) / total) }));
  return (
    <StateGate state={state} onEmpty={onEmpty} skeleton={<Panel className="space-y-4 p-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-7" />)}</Panel>}>
      <Panel className="p-5">
        <BarList rows={rows} fmt={f.count} />
      </Panel>
    </StateGate>
  );
}
