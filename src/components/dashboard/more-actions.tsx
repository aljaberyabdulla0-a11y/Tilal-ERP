"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

// ============================================================
// «إجراءات» — ما زاد عن الإجراءين الأوّلين في رأس اللوحة يُجمع هنا
// (التصميم المعتمد: أساسي + ثانوي + قائمة). روابط حقيقية لا محاكاة:
// نفس الوجهات التي كانت أزراراً متجاورة.
//
// لوحة المفاتيح: ↑↓ بين البنود، Esc يغلق ويعيد التركيز إلى الزرّ.
// ============================================================

export type MoreAction = { href: string; label: string; icon: string };

export default function MoreActions({ actions, label }: { actions: MoreAction[]; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    function onDown(e: MouseEvent | TouchEvent) {
      if (box.current && !box.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open, close]);

  function onKey(e: React.KeyboardEvent) {
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    if (e.key === "Escape") { setOpen(false); btn.current?.focus(); }
  }

  if (actions.length === 0) return null;
  return (
    <div ref={box} className="relative" onKeyDown={onKey}>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="dash-focus inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-sm font-semibold text-ink transition hover:bg-surface-subtle"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[20px]">more_horiz</span>
        {label}
      </button>
      {open && (
        <div role="menu" aria-label={label} className="anim-pop absolute end-0 top-full z-40 mt-1.5 min-w-[13rem] rounded-lg border border-line bg-surface p-1 shadow-overlay">
          {actions.map((a, i) => (
            <Link
              key={`${a.href}-${i}`}
              href={a.href}
              role="menuitem"
              tabIndex={-1}
              onClick={close}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none hover:bg-surface-subtle focus:bg-surface-subtle"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-ink-muted">{a.icon}</span>
              {a.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
