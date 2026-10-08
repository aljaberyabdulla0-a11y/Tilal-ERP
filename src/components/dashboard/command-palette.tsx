"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";

// ============================================================
// مركز الأوامر — Ctrl+K (أو ⌘K).
//
// • قبل الكتابة: الإجراءات السريعة لدور المستخدم (تأتي من التخطيط
//   على الخادم — لا يُقرَّر الدور هنا).
// • بعد حرفين: بحث شامل مجمّع (/api/search) — عملاء ومشاريع ووحدات
//   وحجوزات وموظفون ووسطاء وفواتير ومهام، كلٌّ بما تسمح به RLS.
// • لوحة المفاتيح: ↑↓ للتنقّل، Enter للفتح، Esc للإغلاق.
// ============================================================

export type PaletteAction = { href: string; label: string; icon: string };
type Hit = { id: string; title: string; sub: string | null; href: string };
type Item = { key: string; href: string; title: string; sub?: string | null; icon: string; group: string };

const GROUP_ICON: Record<string, string> = {
  clients: "person", projects: "apartment", units: "door_front", reservations: "key",
  employees: "badge", brokers: "handshake", invoices: "receipt_long", tasks: "checklist",
};

export default function CommandPalette({ actions }: { actions: PaletteAction[] }) {
  const { t } = useI18n();
  const s = t.dash.search;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Record<string, Hit[]>>({});
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // الاختصار العام
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQ("");
      setGroups({});
      setActive(0);
      restoreRef.current?.focus?.();
    }
  }, [open]);

  // البحث بتأخير قصير، ويُلغى الطلب السابق إن كتب المستخدم أكثر
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setGroups({});
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const json = (await res.json()) as { groups?: Record<string, Hit[]> };
        setGroups(json.groups ?? {});
        setActive(0);
      } catch {
        /* أُلغي أو فشل — تبقى النتائج السابقة */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  const items: Item[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const acts = actions
      .filter((a) => !term || a.label.toLowerCase().includes(term))
      .map((a) => ({ key: `a:${a.href}`, href: a.href, title: a.label, icon: a.icon, group: s.actions }));
    const hits = Object.entries(groups).flatMap(([g, list]) =>
      list.map((h) => ({ key: `${g}:${h.id}`, href: h.href, title: h.title, sub: h.sub, icon: GROUP_ICON[g] ?? "search", group: (s.groups as Record<string, string>)[g] ?? g }))
    );
    return [...hits, ...acts];
  }, [actions, groups, q, s]);

  const go = useCallback((href: string) => {
    setOpen(false);
    router.push(href);
  }, [router]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && items[active]) { e.preventDefault(); go(items[active].href); }
  }

  let lastGroup = "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="dash-focus flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink-muted shadow-card transition hover:border-line-strong hover:text-ink sm:min-w-[15rem]"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">search</span>
        <span className="hidden sm:inline">{s.button}</span>
        <span className="sr-only sm:hidden">{s.open}</span>
        <kbd className="ms-auto hidden rounded border border-line bg-surface-subtle px-1.5 text-[10px] font-semibold text-ink-muted sm:inline" dir="ltr">{s.shortcut}</kbd>
      </button>

      {/* بوّابة إلى body: الشريط العلوي فيه backdrop-blur، وهو يجعل fixed نسبياً
          إليه لا إلى الشاشة — فكانت الخلفية المعتمة لا تغطّي الشريط الجانبي. */}
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-3 pt-[10vh]" role="dialog" aria-modal="true" aria-label={s.open} onKeyDown={onKeyDown}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-sheet">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <span aria-hidden="true" className="material-symbols-outlined text-ink-muted">search</span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={s.placeholder}
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={items[active] ? `pi-${active}` : undefined}
                className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
              />
              {loading && <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px] text-ink-muted">progress_activity</span>}
            </div>
            <ul id="palette-list" role="listbox" aria-label={s.open} className="max-h-[60vh] overflow-y-auto p-2">
              {q.trim().length > 0 && q.trim().length < 2 && <li className="px-3 py-2 text-xs text-ink-muted">{s.hint}</li>}
              {q.trim().length >= 2 && !loading && Object.keys(groups).length === 0 && (
                <li className="px-3 py-2 text-xs text-ink-muted">{s.noResults}</li>
              )}
              {items.map((it, i) => {
                const header = it.group !== lastGroup ? it.group : null;
                lastGroup = it.group;
                return (
                  <li key={it.key} role="presentation">
                    {header && <p className="px-3 pb-1 pt-2 text-[11px] font-bold text-ink-muted">{header}</p>}
                    <button
                      id={`pi-${i}`}
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(it.href)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm ${i === active ? "bg-brand-50 text-brand-800" : "text-ink hover:bg-surface-subtle"}`}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-ink-secondary">{it.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{it.title}</span>
                        {it.sub && <span className="block truncate text-xs text-ink-muted">{it.sub}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex gap-4 border-t border-line px-4 py-2 text-[11px] text-ink-muted">
              <span><kbd dir="ltr">↑↓</kbd> {s.navigate}</span>
              <span><kbd>Enter</kbd> {s.select}</span>
              <span><kbd>Esc</kbd> {s.close}</span>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
