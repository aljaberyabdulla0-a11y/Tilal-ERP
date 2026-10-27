"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fill } from "@/lib/dashboard/format";
import { usePreview } from "./shell";
import { Legend } from "./charts";
import {
  Badge, Button, Dialog, EmptyState, ErrorState, Field, Icon, IconButton, INPUT, Menu, Pagination, Panel,
  Segmented, Select, Skeleton, Tabs, Tooltip, useToast,
} from "./ui";

// ============================================================
// نظام التصميم — صفحة مرجعية للرموز والمكوّنات، تُعرض بنفس المكوّنات
// التي بُنيت بها اللوحة (لا صورٌ لها). من يرقّي التصميم إلى الإنتاج
// يبدأ من هنا.
// ============================================================

const SWATCHES: { name: string; hex: string; role: { ar: string; en: string }; dark?: boolean }[] = [
  { name: "forest-900", hex: "#173123", role: { ar: "الشريط الجانبي", en: "Sidebar" }, dark: true },
  { name: "forest-700", hex: "#2E5A40", role: { ar: "أخضر الشعار: الإجراء الأساسي", en: "Logo green: primary action" }, dark: true },
  { name: "mint-300", hex: "#A6DEC0", role: { ar: "البند النشط على الداكن", en: "Active item on dark" } },
  { name: "mint-50", hex: "#EEF7F1", role: { ar: "خلفيات هادئة للهوية", en: "Quiet brand tint" } },
  { name: "paper", hex: "#F4F5F2", role: { ar: "خلفية الصفحة", en: "Page background" } },
  { name: "surface", hex: "#FFFFFF", role: { ar: "اللوحات والحقول", en: "Panels and inputs" } },
  { name: "line", hex: "#E1E4DF", role: { ar: "الحدود الشعرية", en: "Hairlines" } },
  { name: "ink", hex: "#1C2320", role: { ar: "النصّ الأساسي", en: "Primary text" }, dark: true },
  { name: "ink-2", hex: "#525C56", role: { ar: "النصّ الثانوي", en: "Secondary text" }, dark: true },
  { name: "ink-3", hex: "#68726C", role: { ar: "التسميات الخافتة (4.6:1)", en: "Muted labels (4.6:1)" }, dark: true },
];

const STATUS: { name: string; hex: string; tone: "pos" | "neg" | "warn" | "info" }[] = [
  { name: "pos", hex: "#1B6E45", tone: "pos" },
  { name: "warn", hex: "#925408", tone: "warn" },
  { name: "neg", hex: "#B3261E", tone: "neg" },
  { name: "info", hex: "#2C5D8A", tone: "info" },
];

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-tp-line py-8 lg:grid-cols-[14rem_1fr] lg:gap-10">
      <div>
        <h2 className="text-base font-bold text-tp-ink">{title}</h2>
        {hint && <p className="mt-1 text-[13px] text-tp-ink-3">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default function SystemSheet() {
  const { locale, t } = useI18n();
  const { p } = usePreview();
  const s = p.system;
  const x = s.sample;
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [tab, setTab] = useState("0");
  const [seg, setSeg] = useState("a");
  const [page, setPage] = useState(2);
  const [email, setEmail] = useState("name@tilal");

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <header className="mb-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-tp-ink sm:text-[28px] sm:leading-9">{s.title}</h1>
        <p className="mt-2 text-sm text-tp-ink-2">{s.intro}</p>
      </header>

      <Block title={s.color} hint={s.colorHint}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {SWATCHES.map((c) => (
            <li key={c.name} className="overflow-hidden rounded-lg border border-tp-line bg-tp-surface">
              <div className="flex h-16 items-end p-2" style={{ background: c.hex }}>
                <span dir="ltr" className={`text-[11px] font-semibold ${c.dark ? "text-white/85" : "text-tp-ink-2"}`}>{c.hex}</span>
              </div>
              <div className="px-3 py-2">
                <p dir="ltr" className="text-start text-xs font-semibold text-tp-ink">{c.name}</p>
                <p className="mt-0.5 text-[11px] text-tp-ink-3">{c.role[locale]}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          {STATUS.map((c) => (
            <Badge key={c.name} tone={c.tone}><span dir="ltr">{c.name} {c.hex}</span></Badge>
          ))}
        </div>
      </Block>

      <Block title={s.type} hint={s.typeHint}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1"><span dir="ltr" className="w-16 text-[11px] text-tp-ink-3">40 / 700</span><span className="text-[40px] font-bold leading-[44px] text-tp-ink">2.84 {locale === "ar" ? "مليار د.ع" : "B IQD"}</span></div>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1"><span dir="ltr" className="w-16 text-[11px] text-tp-ink-3">28 / 700</span><span className="text-[28px] font-bold leading-9 text-tp-ink">{p.executive}</span></div>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1"><span dir="ltr" className="w-16 text-[11px] text-tp-ink-3">16 / 700</span><span className="text-base font-bold text-tp-ink">{locale === "ar" ? "أداء المبيعات" : "Sales performance"}</span></div>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1"><span dir="ltr" className="w-16 text-[11px] text-tp-ink-3">14 / 400</span><span className="max-w-xl text-sm text-tp-ink-2">{locale === "ar" ? "قيمة الصفقات الفائزة عبر الزمن مقابل الفترة السابقة. النصّ الأساسي للفقرات والشروح." : "Won deal value over time against the previous period. The body size for paragraphs and explanations."}</span></div>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1"><span dir="ltr" className="w-16 text-[11px] text-tp-ink-3">13 / 400</span><span className="tp-tabular flex gap-4 text-[13px] text-tp-ink"><span>1,284</span><span>385,900,000</span><span>37.5%</span></span></div>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1"><span dir="ltr" className="w-16 text-[11px] text-tp-ink-3">12 / 400</span><span className="text-xs text-tp-ink-3">{locale === "ar" ? "مقابل 2.51 مليار د.ع في الفترة السابقة" : "vs IQD 2.51B in the previous period"}</span></div>
        </div>
      </Block>

      <Block title={s.buttons}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon="save">{x.primary}</Button>
          <Button variant="secondary" icon="download">{x.secondary}</Button>
          <Button variant="ghost">{x.ghost}</Button>
          <Button variant="danger" icon="event_busy">{x.danger}</Button>
          <Button variant="primary" loading>{x.loading}</Button>
          <Button variant="secondary" disabled>{x.disabled}</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon="add">{x.primary}</Button>
          <Button size="sm" variant="secondary">{x.secondary}</Button>
          <IconButton icon="edit" label={x.menuItems[0]} />
          <IconButton icon="more_vert" label={x.menu} />
        </div>
      </Block>

      <Block title={s.inputs}>
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label={x.search}>
            {(a) => (
              <span className="relative block">
                <Icon name="search" className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-[18px] text-tp-ink-3" />
                <input {...a} type="search" className={`${INPUT} ps-9`} placeholder={x.search} />
              </span>
            )}
          </Field>
          <Field label={x.email} error={/^\S+@\S+\.\S+$/.test(email) ? null : x.emailErr}>
            {(a) => <input {...a} dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${INPUT} text-start`} />}
          </Field>
          <Field label={x.amount} hint={locale === "ar" ? "الأرقام لاتينية في اللغتين" : "Latin digits in both languages"}>
            {(a) => <input {...a} dir="ltr" inputMode="numeric" defaultValue="32,500,000" className={`${INPUT} tp-tabular text-start`} />}
          </Field>
          <Field label={x.date}>
            {(a) => <input {...a} type="date" defaultValue="2026-11-15" className={INPUT} />}
          </Field>
          <Field label={p.newLead.project} className="sm:col-span-2">
            {(a) => (
              <Select {...a} value="p1" onChange={() => {}} className="w-full">
                <option value="p1">{locale === "ar" ? "تلال الربيع" : "Tilal Al-Rabee"}</option>
              </Select>
            )}
          </Field>
        </div>
      </Block>

      <Block title={s.badges}>
        <div className="flex flex-wrap gap-2">
          <Badge tone="pos" icon="check_circle">{x.statuses.available}</Badge>
          <Badge tone="warn" icon="schedule">{x.statuses.reserved}</Badge>
          <Badge tone="brand" icon="sell">{x.statuses.sold}</Badge>
          <Badge tone="neg" icon="error">{x.statuses.overdue}</Badge>
          <Badge tone="info" icon="hourglass_top">{x.statuses.info}</Badge>
          <Badge tone="neutral" icon="block">{x.statuses.neutral}</Badge>
        </div>
      </Block>

      <Block title={s.tabs}>
        <div className="max-w-xl space-y-5">
          <Tabs label={s.tabs} value={tab} onChange={setTab} tabs={x.tabsDemo.map((l, i) => ({ value: String(i), label: l, count: [706, 412, 61, 233][i] }))} />
          <div className="flex flex-wrap items-center gap-3">
            <Segmented label={s.tabs} value={seg} onChange={setSeg} options={[{ value: "a", label: x.tabsDemo[0] }, { value: "b", label: x.tabsDemo[1] }, { value: "c", label: x.tabsDemo[2] }]} />
            <Menu
              label={x.menu}
              align="start"
              items={x.menuItems.map((m, i) => ({ key: m, label: m, icon: ["edit", "link", "archive"][i], danger: i === 2 }))}
              onPick={(k) => toast({ tone: "info", message: fill(x.menuPicked, { item: k }) })}
              trigger={(tr) => <Button {...tr.props} onClick={tr.toggle} variant="secondary" icon="expand_more">{x.menu}</Button>}
            />
            <Tooltip label={x.tooltipBody}>
              <Button variant="ghost" icon="info">{x.tooltip}</Button>
            </Tooltip>
          </div>
        </div>
      </Block>

      <Block title={s.overlays}>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="open_in_new" onClick={() => setDialog(true)}>{x.openDialog}</Button>
          <Button variant="secondary" icon="check_circle" onClick={() => toast({ tone: "pos", message: x.toastPosMsg })}>{x.toastPos}</Button>
          <Button variant="secondary" icon="error" onClick={() => toast({ tone: "neg", message: x.toastNegMsg })}>{x.toastNeg}</Button>
        </div>
        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title={x.dialogTitle}
          description={x.dialogBody}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(false)}>{x.ghost}</Button>
              <Button variant="danger" onClick={() => { setDialog(false); toast({ tone: "info", message: x.dialogDone }); }}>{x.dialogConfirm}</Button>
            </>
          }
        />
      </Block>

      <Block title={s.states}>
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel className="space-y-3 p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-3 w-24" />
          </Panel>
          <Panel><EmptyState icon="event_busy" title={p.emptyTitle} body={p.emptyBody} action={<Button size="sm" variant="secondary">{p.emptyAction}</Button>} /></Panel>
          <div><ErrorState title={p.errorTitle} body={p.errorBody} action={<Button size="sm" variant="secondary" icon="refresh">{p.retry}</Button>} /></div>
        </div>
      </Block>

      <Block title={s.table} hint={p.tableCards}>
        <Panel className="max-w-2xl overflow-hidden">
          <div className="h-2" />
          <Pagination
            page={page}
            pages={4}
            onPage={setPage}
            summary={fill(p.perPage, { from: (page - 1) * 25 + 1, to: Math.min(page * 25, 87), total: 87 })}
            labels={{ prev: t.dash.table.prev, next: t.dash.table.next, page: fill(p.page, { n: page, total: 4 }) }}
          />
        </Panel>
      </Block>

      <Block title={s.viz} hint={s.vizHint}>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-end gap-1.5" aria-hidden="true">
            {[40, 64, 28, 80, 52, 96, 70].map((h, i) => (
              <div key={i} className="relative flex h-24 w-5 items-end justify-center">
                <div className="w-full rounded-t-[4px] bg-tp-viz1" style={{ height: `${h}%` }} />
                <div className="absolute h-[2px] w-7 rounded-full bg-tp-ink-2 shadow-[0_0_0_1.5px_white]" style={{ bottom: `${[52, 48, 44, 60, 70, 74, 66][i]}%` }} />
              </div>
            ))}
          </div>
          <Legend items={[
            { label: "viz-1 #2B8058", className: "bg-tp-viz1" },
            { label: "viz-2 #D9A23F", className: "bg-tp-viz2" },
            { label: locale === "ar" ? "الفترة السابقة" : "Previous period", className: "bg-tp-ink-2", line: true },
          ]} />
        </div>
      </Block>
    </div>
  );
}
