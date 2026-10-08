"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";
import { fill, fmtMoney, fmtNumber, fmtPct } from "@/lib/dashboard/format";

// ============================================================
// جدول اللوحات — بحث، ترتيب، تقسيم صفحات، إظهار الأعمدة، تصدير CSV،
// نقر الصف، رأس ثابت، وبطاقات بدل الجدول على الجوّال.
//
// ⚠️ تعريف الأعمدة **بيانات لا دوال**: مكوّن الخادم لا يمرّر دالّة
//    عرض إلى مكوّن عميل. فالنوع (kind) يقرّر التنسيق هنا، والقيم
//    تصل جاهزة. والجدول للعرض فقط — صفوفه ما جاء محسوباً من القاعدة
//    لا أكثر (لا تجميع هنا).
// ============================================================

export type ColKind = "text" | "number" | "money" | "pct" | "badge";

export type Column = {
  key: string;
  label: string;
  kind?: ColKind;
  /** للنوع badge: مفتاح الحقل الذي يحمل نبرة الشارة */
  toneKey?: string;
  hideOnMobile?: boolean;
  defaultHidden?: boolean;
  /** الحقل الأساسي يظهر عنواناً لبطاقة الجوّال */
  primary?: boolean;
};

export type Row = Record<string, string | number | null> & { _href?: string | null; _id?: string };

const BADGE: Record<string, string> = {
  good: "bg-success-50 text-success-700 ring-success-100",
  warning: "bg-warning-50 text-warning-700 ring-warning-100",
  danger: "bg-danger-50 text-danger-700 ring-danger-100",
  info: "bg-info-50 text-info-700 ring-info-100",
  neutral: "bg-surface-sunken text-ink-secondary ring-line",
};

const BADGE_ICON: Record<string, string> = {
  good: "check_circle", warning: "schedule", danger: "error", info: "info", neutral: "remove",
};

export default function DataTable({
  columns, rows, pageSize = 8, searchable = true, exportName = "export", caption, initialSort,
}: {
  columns: Column[];
  rows: Row[];
  pageSize?: number;
  searchable?: boolean;
  exportName?: string;
  caption: string;
  initialSort?: { key: string; dir: "asc" | "desc" };
}) {
  const { locale, t } = useI18n();
  const tt = t.dash.table;
  const cur = t.dash.common.currency;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)));
  const [colMenu, setColMenu] = useState(false);

  const visible = columns.filter((c) => !hidden.has(c.key));
  const primary = columns.find((c) => c.primary) ?? columns[0];

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle
      ? rows.filter((r) => columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(needle)))
      : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const numeric = col && col.kind !== "text" && col.kind !== "badge";
      out = [...out].sort((a, b) => {
        const av = a[sort.key], bv = b[sort.key];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = numeric ? Number(av) - Number(bv) : String(av).localeCompare(String(bv), locale);
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, columns, q, sort, locale]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const p = Math.min(page, pages - 1);
  const slice = filtered.slice(p * pageSize, p * pageSize + pageSize);

  function fmt(c: Column, v: string | number | null) {
    if (v === null || v === undefined || v === "") return "—";
    switch (c.kind) {
      case "money": return fmtMoney(Number(v), locale, cur);
      case "number": return fmtNumber(Number(v), locale, 1);
      case "pct": return fmtPct(Number(v), locale);
      default: return String(v);
    }
  }

  function cell(c: Column, r: Row) {
    const v = r[c.key];
    if (c.kind === "badge") {
      const tone = String((c.toneKey && r[c.toneKey]) || "neutral");
      return (
        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${BADGE[tone] ?? BADGE.neutral}`}>
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{BADGE_ICON[tone] ?? "remove"}</span>
          {fmt(c, v)}
        </span>
      );
    }
    return <span>{fmt(c, v)}</span>;
  }

  function toggleSort(key: string) {
    setPage(0);
    setSort((s) => (s?.key === key ? (s.dir === "desc" ? { key, dir: "asc" } : null) : { key, dir: "desc" }));
  }

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [visible.map((c) => esc(c.label)).join(",")];
    for (const r of filtered) lines.push(visible.map((c) => esc(r[c.key])).join(","));
    // BOM كي يفتح الإكسل العربية سليمة
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {searchable && (
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="sr-only">{tt.search}</span>
            <span aria-hidden="true" className="material-symbols-outlined pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-[18px] text-ink-muted">search</span>
            <input
              type="search"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
              placeholder={tt.search}
              className="dash-focus h-9 w-full rounded-lg border border-line bg-surface pe-3 ps-9 text-sm"
            />
          </label>
        )}
        <div className="relative ms-auto flex items-center gap-1">
          <button type="button" onClick={() => setColMenu((v) => !v)} aria-expanded={colMenu} className="dash-focus hidden h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-ink-secondary hover:bg-surface-sunken sm:inline-flex">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">view_column</span>
            {tt.columns}
          </button>
          {colMenu && (
            <div className="absolute end-0 top-10 z-20 w-56 rounded-lg border border-line bg-surface p-2 shadow-card-hover">
              {columns.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-subtle">
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.key)}
                    disabled={c.key === primary.key}
                    onChange={() => setHidden((h) => {
                      const n = new Set(h);
                      if (n.has(c.key)) n.delete(c.key); else n.add(c.key);
                      return n;
                    })}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
          <button type="button" onClick={exportCsv} className="dash-focus inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-ink-secondary hover:bg-surface-sunken">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">download</span>
            {tt.export}
          </button>
        </div>
      </div>

      {slice.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">{tt.noResults}</p>
      ) : (
        <>
          {/* سطح المكتب والجهاز اللوحي */}
          <div className="hidden max-h-[28rem] overflow-auto rounded-lg border border-line sm:block">
            <table className="num-tabular w-full text-sm">
              <caption className="sr-only">{caption}</caption>
              <thead className="sticky top-0 z-10 bg-surface-subtle text-xs text-ink-secondary">
                <tr>
                  {visible.map((c) => {
                    const on = sort?.key === c.key;
                    return (
                      <th key={c.key} scope="col" aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"} className={`whitespace-nowrap px-3 py-2 text-start font-semibold ${c.hideOnMobile ? "" : ""}`}>
                        <button type="button" onClick={() => toggleSort(c.key)} className="dash-focus inline-flex items-center gap-0.5 rounded hover:text-ink" title={on && sort!.dir === "desc" ? tt.sortAsc : tt.sortDesc}>
                          {c.label}
                          <span aria-hidden="true" className={`material-symbols-outlined text-[14px] ${on ? "text-brand-700" : "opacity-30"}`}>
                            {on ? (sort!.dir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {slice.map((r, i) => (
                  <tr key={r._id ?? i} className="border-t border-line transition hover:bg-surface-subtle">
                    {visible.map((c, j) => (
                      <td key={c.key} className="whitespace-nowrap px-3 py-2 text-start text-ink">
                        {j === 0 && r._href ? (
                          <Link href={r._href} className="dash-focus rounded font-semibold text-brand-700 hover:underline">{cell(c, r)}</Link>
                        ) : cell(c, r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* الجوّال: بطاقات — الجدول العريض لا يُقرأ على شاشة صغيرة */}
          <ul className="space-y-2 sm:hidden">
            {slice.map((r, i) => {
              const body = (
                <>
                  <p className="mb-1.5 font-semibold text-ink">{cell(primary, r)}</p>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {visible.filter((c) => c.key !== primary.key && !c.hideOnMobile).map((c) => (
                      <div key={c.key} className="flex justify-between gap-2">
                        <dt className="text-ink-muted">{c.label}</dt>
                        <dd className="text-ink">{cell(c, r)}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              );
              return (
                <li key={r._id ?? i}>
                  {r._href ? (
                    <Link href={r._href} className="dash-card-link block p-3">{body}</Link>
                  ) : (
                    <div className="dash-card p-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {filtered.length > pageSize && (
        <div className="mt-3 flex items-center justify-between text-xs text-ink-secondary">
          <span dir="ltr">{fill(tt.rows, { from: p * pageSize + 1, to: Math.min(filtered.length, (p + 1) * pageSize), total: filtered.length })}</span>
          <div className="flex gap-1">
            <button type="button" disabled={p === 0} onClick={() => setPage(p - 1)} className="dash-focus rounded-lg border border-line px-3 py-1.5 font-semibold disabled:opacity-40">{tt.prev}</button>
            <button type="button" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} className="dash-focus rounded-lg border border-line px-3 py-1.5 font-semibold disabled:opacity-40">{tt.next}</button>
          </div>
        </div>
      )}
    </div>
  );
}
