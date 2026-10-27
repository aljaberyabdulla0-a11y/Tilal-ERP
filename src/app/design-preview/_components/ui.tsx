"use client";

import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode,
} from "react";
import type { Delta } from "@/lib/report-engine";
import { useI18n } from "@/lib/i18n/client";
import { fmtPct } from "@/lib/dashboard/format";

// ============================================================
// مكوّنات المعاينة الأساسية — نظام تصميم صغير محصور في /design-preview.
//
// القواعد:
//   • الأصناف الاتجاهية منطقية (start/end، ps/pe) فينقلب كل شيء مع اللغة.
//   • نصف قطر بحسب الرتبة: 6px للحقول والأزرار، 12px للوحات، كامل للشارات
//     — لا نصف قطر واحد على كل شيء.
//   • الظلّ للطبقات العائمة وحدها؛ اللوحات حدٌّ شعري بلا ظلّ.
//   • كل عنصر تفاعلي له حلقة تركيز مرئية (tp-focus).
//   • الطبقات (حوار، قائمة) تُرسم داخل .tp-root لا في body، كي ترث رموزه.
// ============================================================

export function Icon({ name, className = "", filled = false }: { name: string; className?: string; filled?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined shrink-0 leading-none ${className}`}
      style={filled ? { fontVariationSettings: '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24' } : undefined}
    >
      {name}
    </span>
  );
}

// ===== الأزرار =====

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BTN: Record<ButtonVariant, string> = {
  primary: "bg-tp-forest-700 text-white hover:bg-tp-forest-600 active:bg-tp-forest-900",
  secondary: "border border-tp-line-strong bg-tp-surface text-tp-ink hover:border-tp-ink-3/60 hover:bg-tp-paper",
  ghost: "text-tp-ink-2 hover:bg-tp-sunken hover:text-tp-ink",
  danger: "bg-tp-neg text-white hover:bg-tp-neg/90",
};

const BTN_SIZE = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-9 gap-2 px-3.5 text-sm",
};

export function Button({
  variant = "secondary", size = "md", icon, loading = false, className = "", children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant; size?: "sm" | "md"; icon?: string; loading?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`tp-focus inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${BTN_SIZE[size]} ${BTN[variant]} ${className}`}
    >
      {loading ? (
        <Icon name="progress_activity" className="animate-spin text-[18px]" />
      ) : icon ? (
        <Icon name={icon} className="text-[18px]" />
      ) : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon, label, className = "", dark = false, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; dark?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={`${dark ? "tp-focus-dark text-white/75 hover:bg-white/10 hover:text-white" : "tp-focus text-tp-ink-2 hover:bg-tp-sunken hover:text-tp-ink"} relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors ${className}`}
    >
      <Icon name={icon} className="text-[20px]" />
      {children}
    </button>
  );
}

// ===== التلميح — بالمرور وبالتركيز بلوحة المفاتيح =====

export function Tooltip({
  label, children, side = "top", wide = false,
}: { label: string; children: ReactNode; side?: "top" | "end" | "below"; wide?: boolean }) {
  // «below» يبدأ من حافّة العنصر ويمتدّ نحو المحتوى — لا خارج الشاشة
  const pos =
    side === "end"
      ? "start-full top-1/2 ms-2 -translate-y-1/2"
      : side === "below"
      ? "start-0 top-full mt-2"
      : "bottom-full left-1/2 mb-2 -translate-x-1/2";
  // ⚠️ hidden لا invisible: المخفيّ بـ visibility يبقى في التخطيط، فكان
  //    تلميحٌ عريض عند حافّة الجوّال يمدّ الصفحة أفقياً
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-40 hidden rounded-md bg-tp-forest-950 px-2 py-1 text-xs font-medium text-white group-hover/tt:block group-focus-within/tt:block ${wide ? "w-64 max-w-[calc(100vw-3rem)] whitespace-normal py-2 leading-relaxed" : "whitespace-nowrap"} ${pos}`}
      >
        {label}
      </span>
    </span>
  );
}

// ===== الشارات =====

export type Tone = "pos" | "neg" | "warn" | "info" | "neutral" | "brand";

const BADGE: Record<Tone, string> = {
  pos: "bg-tp-pos-bg text-tp-pos",
  neg: "bg-tp-neg-bg text-tp-neg",
  warn: "bg-tp-warn-bg text-tp-warn",
  info: "bg-tp-info-bg text-tp-info",
  neutral: "bg-tp-sunken text-tp-ink-2",
  brand: "bg-tp-mint-100 text-tp-forest-700",
};

export function Badge({ tone = "neutral", icon, children, className = "" }: { tone?: Tone; icon?: string; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[tone]} ${className}`}>
      {icon && <Icon name={icon} className="text-[14px]" />}
      {children}
    </span>
  );
}

export function MockBadge() {
  const { locale } = useI18n();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-tp-line-strong px-2 py-0.5 text-[11px] font-medium text-tp-ink-3">
      <Icon name="science" className="text-[13px]" />
      {locale === "en" ? "Sample" : "تجريبي"}
    </span>
  );
}

// ===== مجموعة اختيار (Segmented) — لاختيار واحد من قليل =====

export function Segmented<T extends string>({
  value, options, onChange, label, size = "md",
}: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; size?: "sm" | "md";
}) {
  const { dir } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: React.KeyboardEvent, i: number) {
    const next = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const prev = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    let j = -1;
    if (e.key === next) j = (i + 1) % options.length;
    if (e.key === prev) j = (i - 1 + options.length) % options.length;
    if (j >= 0) {
      e.preventDefault();
      onChange(options[j].value);
      refs.current[j]?.focus();
    }
  }
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-md bg-tp-sunken p-0.5">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`tp-focus whitespace-nowrap rounded-[5px] font-semibold transition-colors ${size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-[13px]"} ${on ? "bg-tp-surface text-tp-forest-700 shadow-[0_1px_2px_rgba(17,36,26,0.08)]" : "text-tp-ink-2 hover:text-tp-ink"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ===== الألسنة =====

export function Tabs<T extends string>({
  value, tabs, onChange, label,
}: { value: T; tabs: { value: T; label: string; count?: number }[]; onChange: (v: T) => void; label: string }) {
  const { dir } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: React.KeyboardEvent, i: number) {
    const next = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const prev = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    let j = -1;
    if (e.key === next) j = (i + 1) % tabs.length;
    if (e.key === prev) j = (i - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") j = 0;
    if (e.key === "End") j = tabs.length - 1;
    if (j >= 0) {
      e.preventDefault();
      onChange(tabs[j].value);
      refs.current[j]?.focus();
    }
  }
  return (
    <div role="tablist" aria-label={label} className="flex gap-5 overflow-x-auto border-b border-tp-line">
      {tabs.map((tb, i) => {
        const on = tb.value === value;
        return (
          <button
            key={tb.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(tb.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`tp-focus relative -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 pb-2.5 pt-1 text-sm font-semibold transition-colors ${on ? "border-tp-forest-700 text-tp-ink" : "border-transparent text-tp-ink-3 hover:text-tp-ink"}`}
          >
            {tb.label}
            {tb.count !== undefined && (
              <span className={`tp-tabular rounded-full px-1.5 text-[11px] ${on ? "bg-tp-mint-100 text-tp-forest-700" : "bg-tp-sunken text-tp-ink-3"}`}>{tb.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ===== الحقول =====

export const INPUT =
  "tp-focus h-9 w-full rounded-md border border-tp-line-strong bg-tp-surface px-3 text-sm text-tp-ink placeholder:text-tp-ink-3 transition-colors hover:border-tp-ink-3/60 disabled:cursor-not-allowed disabled:bg-tp-sunken aria-[invalid=true]:border-tp-neg";

export function Field({
  label, hint, error, children, className = "",
}: {
  label: string; hint?: string; error?: string | null; className?: string;
  children: (p: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-tp-ink">{label}</label>
      {children({ id, "aria-describedby": hint || error ? msgId : undefined, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={msgId} className="mt-1.5 flex items-center gap-1 text-xs font-medium text-tp-neg">
          <Icon name="error" className="text-[14px]" />
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="mt-1.5 text-xs text-tp-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export function Select({
  value, onChange, children, className = "", ...rest
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange"> & { onChange: (v: string) => void }) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} cursor-pointer appearance-none pe-8`}
      >
        {children}
      </select>
      <Icon name="expand_more" className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-[18px] text-tp-ink-3" />
    </span>
  );
}

// ===== الطبقات العائمة: إغلاق بالنقر خارجها وبـ Esc =====

export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export function Popover({
  open, onClose, button, children, align = "end", className = "",
}: {
  open: boolean; onClose: () => void; button: ReactNode; children: ReactNode; align?: "start" | "end"; className?: string;
}) {
  const ref = useDismiss<HTMLDivElement>(open, onClose);
  return (
    <div ref={ref} className="relative">
      {button}
      {open && (
        <div className={`tp-pop absolute top-full z-40 mt-1.5 rounded-lg border border-tp-line bg-tp-surface shadow-tp-overlay ${align === "end" ? "end-0" : "start-0"} ${className}`}>
          {children}
        </div>
      )}
    </div>
  );
}

// قائمة منسدلة: أسهم للتنقّل، Enter للاختيار، Esc للإغلاق وإرجاع التركيز
export function Menu({
  label, items, onPick, align = "end", trigger,
}: {
  label: string;
  items: { key: string; label: string; icon?: string; danger?: boolean }[];
  onPick: (key: string) => void;
  align?: "start" | "end";
  // props تُنشَر على زرّ المُطلِق كما هي؛ toggle يُربط بـ onClick (لا يُنشَر: ليس سمة DOM)
  trigger: (p: { open: boolean; toggle: () => void; props: { "aria-expanded": boolean; "aria-haspopup": "menu"; id: string } }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [open]);
  function onKey(e: React.KeyboardEvent) {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    if (e.key === "Escape") { setOpen(false); document.getElementById(id)?.focus(); }
  }
  return (
    <Popover
      open={open}
      onClose={close}
      align={align}
      className="min-w-[13rem] p-1"
      button={trigger({ open, toggle: () => setOpen((o) => !o), props: { "aria-expanded": open, "aria-haspopup": "menu", id } })}
    >
      <div ref={listRef} role="menu" aria-label={label} onKeyDown={onKey}>
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => { setOpen(false); onPick(it.key); }}
            className={`tp-focus flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm transition-colors hover:bg-tp-paper focus:bg-tp-paper ${it.danger ? "text-tp-neg" : "text-tp-ink"}`}
          >
            {it.icon && <Icon name={it.icon} className={`text-[18px] ${it.danger ? "" : "text-tp-ink-3"}`} />}
            {it.label}
          </button>
        ))}
      </div>
    </Popover>
  );
}

// ===== الحوار: وسط الشاشة على المكتب، وورقة من الأسفل على الجوّال =====

export function Dialog({
  open, onClose, title, description, children, footer,
}: {
  open: boolean; onClose: () => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode;
}) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])");
    (first ?? panel.current)?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key !== "Tab" || !panel.current) return;
      const f = Array.from(panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])"));
      if (f.length === 0) return;
      const a = f[0];
      const z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      before?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-tp-forest-950/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="tp-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-tp-surface shadow-tp-overlay outline-none sm:max-w-lg sm:rounded-xl"
      >
        <div className="flex items-start gap-3 border-b border-tp-line px-5 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold text-tp-ink">{title}</h2>
            {description && <p id={descId} className="mt-1 text-[13px] text-tp-ink-2">{description}</p>}
          </div>
          <IconButton icon="close" label={t.common.close} data-close onClick={onClose} className="-me-2 -mt-1" />
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-tp-line bg-tp-paper/60 px-5 py-3 sm:rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

// ===== الإشعارات المنبثقة (Toast) =====

type ToastItem = { id: number; tone: "pos" | "neg" | "info"; message: string };
const ToastCtx = createContext<(t: Omit<ToastItem, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);
  const icon = { pos: "check_circle", neg: "error", info: "info" } as const;
  const color = { pos: "text-tp-mint-300", neg: "text-[#F4A9A3]", info: "text-white/80" } as const;
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((item) => (
          <div key={item.id} role="status" className="tp-sheet pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-lg bg-tp-forest-950 px-4 py-3 text-sm text-white shadow-tp-overlay">
            <Icon name={icon[item.tone]} className={`mt-px text-[18px] ${color[item.tone]}`} filled />
            <p className="flex-1 leading-relaxed">{item.message}</p>
            <button
              type="button"
              onClick={() => setItems((xs) => xs.filter((x) => x.id !== item.id))}
              className="tp-focus-dark -me-1 rounded text-white/60 hover:text-white"
              aria-label={t.common.close}
            >
              <Icon name="close" className="text-[18px]" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ===== الحالات =====

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`tp-skeleton ${className}`} />;
}

export function EmptyState({ icon = "inbox", title, body, action }: { icon?: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-tp-mint-50 text-tp-forest-700">
        <Icon name={icon} className="text-[22px]" />
      </span>
      <p className="text-sm font-semibold text-tp-ink">{title}</p>
      {body && <p className="mt-1 max-w-xs text-[13px] text-tp-ink-2">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-tp-neg/25 bg-tp-neg-bg/60 p-4">
      <Icon name="error" className="mt-0.5 text-[20px] text-tp-neg" />
      <div className="min-w-[12rem] flex-1">
        <p className="text-sm font-semibold text-tp-ink">{title}</p>
        {body && <p className="mt-0.5 text-[13px] text-tp-ink-2">{body}</p>}
      </div>
      {action && <div className="ms-auto">{action}</div>}
    </div>
  );
}

// ===== الترقيم =====

export function Pagination({
  page, pages, onPage, summary, labels,
}: {
  page: number; pages: number; onPage: (p: number) => void; summary: string; labels: { prev: string; next: string; page: string };
}) {
  return (
    <nav aria-label={labels.page} className="flex flex-wrap items-center justify-between gap-3 border-t border-tp-line px-4 py-3">
      <p className="tp-tabular text-xs text-tp-ink-3">{summary}</p>
      <div className="flex items-center gap-1">
        <IconButton icon="chevron_left" label={labels.prev} className="rtl:rotate-180" disabled={page <= 1} onClick={() => onPage(page - 1)} />
        {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPage(n)}
            aria-current={n === page ? "page" : undefined}
            className={`tp-focus tp-tabular h-8 min-w-8 rounded-md px-2 text-[13px] font-semibold transition-colors ${n === page ? "bg-tp-forest-700 text-white" : "text-tp-ink-2 hover:bg-tp-sunken"}`}
          >
            {n}
          </button>
        ))}
        <IconButton icon="chevron_right" label={labels.next} className="rtl:rotate-180" disabled={page >= pages} onClick={() => onPage(page + 1)} />
      </div>
    </nav>
  );
}

// ===== اللوحات والأقسام =====

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-tp-line bg-tp-surface ${className}`}>{children}</div>;
}

export function SectionHeader({
  id, title, hint, action, mock = true,
}: { id?: string; title: string; hint?: string; action?: ReactNode; mock?: boolean }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 id={id} className="text-base font-bold text-tp-ink">{title}</h2>
          {mock && <MockBadge />}
        </div>
        {hint && <p className="mt-0.5 text-[13px] text-tp-ink-3">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// ===== مؤشّر التغيّر =====
// السهم يتبع إشارة الرقم، واللون يتبع الحكم (جيد/سيئ) — فارتفاع دورة البيع
// سهمٌ للأعلى بلون التراجع. ولا أخضر حيث لا حكم (اتجاه محايد).

export function DeltaChip({ delta, compact = false }: { delta: Delta | null; compact?: boolean }) {
  const { locale, t } = useI18n();
  const c = t.dash.common;
  if (!delta || delta.previous === null || delta.current === null) return null;
  if (delta.change === 0) {
    return <span className="text-xs font-medium text-tp-ink-3">{c.noChange}</span>;
  }
  const up = (delta.change ?? 0) > 0;
  const tone = delta.tone === "good" ? "text-tp-pos" : delta.tone === "bad" ? "text-tp-neg" : "text-tp-ink-2";
  const text = delta.pct === null ? c.newValue : fmtPct(Math.abs(delta.pct), locale);
  const verdict = delta.tone === "good" ? c.better : delta.tone === "bad" ? c.worse : "";
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${compact ? "text-xs" : "text-[13px]"} ${tone}`}>
      <Icon name={up ? "arrow_upward" : "arrow_downward"} className={compact ? "text-[14px]" : "text-[16px]"} />
      <span className="tp-tabular">{text}</span>
      <span className="sr-only">{`${up ? c.up : c.down}${verdict ? ` — ${verdict}` : ""}`}</span>
    </span>
  );
}
