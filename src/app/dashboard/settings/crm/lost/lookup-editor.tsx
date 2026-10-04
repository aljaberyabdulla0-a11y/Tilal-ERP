"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// محرّر قائمة مرجعية لتحليل الخسارة — جدول واحد بحقول يحدّدها المستدعي.
//
// لا حذف: صفٌّ مرجعي تشير إليه خسائر مسجّلة، وحذفه يمحو معنى التقرير.
// التعطيل يخفيه من النموذج ويُبقي تاريخه (نفس مبدأ list-editor).
// الحفظ عند مغادرة الحقل؛ وكل تعديل يدخل audit_log بمحفّز 140.
// ============================================================

export type FieldSpec = {
  key: string;
  label: string;
  type: "text" | "number" | "bool" | "select";
  options?: { value: string; label: string }[];
  width?: string;
  required?: boolean;   // مطلوب عند الإضافة
  readOnlyAfterCreate?: boolean; // الرمز لا يُعاد تسميته
};

type Row = Record<string, any>;

export default function LookupEditor({
  table,
  pk,
  rows,
  fields,
  fixed,
  addLabel,
  renderBelow,
  hasSortOrder = true,
}: {
  table: string;
  pk: string;
  rows: Row[];
  fields: FieldSpec[];
  fixed?: Record<string, unknown>;   // قيم ثابتة عند الإضافة (category_id مثلاً)
  addLabel: string;
  renderBelow?: (row: Row) => React.ReactNode;
  hasSortOrder?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [draft, setDraft] = useState<Row>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function update(id: string, patch: Row) {
    setBusy(id);
    setErr(null);
    const { error } = await supabase.from(table).update(patch).eq(pk, id);
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  async function add() {
    for (const f of fields) {
      if (f.required && (draft[f.key] === undefined || String(draft[f.key]).trim() === "")) {
        return setErr(`${f.label}: مطلوب`);
      }
    }
    setBusy("add");
    setErr(null);
    const maxOrder = rows.reduce((m, r) => Math.max(m, Number(r.sort_order ?? 0)), 0);
    const rec: Row = { ...fixed };
    for (const f of fields) {
      const v = draft[f.key];
      if (v === undefined || v === "") continue;
      rec[f.key] = f.type === "number" ? Number(v) : typeof v === "string" ? v.trim() : v;
    }
    if (hasSortOrder) rec.sort_order = maxOrder + 10;
    const { error } = await supabase.from(table).insert(rec);
    setBusy(null);
    if (error) return setErr(error.message);
    setDraft({});
    router.refresh();
  }

  const cell = "rounded border border-gray-300 px-2 py-1 text-xs";

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {err && <p className="border-b bg-red-50 px-4 py-2 text-xs text-red-700">{err}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-start text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              {renderBelow && <th className="w-8" />}
              {fields.map((f) => <th key={f.key} className="px-3 py-2 text-start font-medium">{f.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => {
              const id = String(r[pk]);
              return (
                <FragmentRow key={id}>
                  <tr className={r.is_active === false ? "opacity-50" : ""}>
                    {renderBelow && (
                      <td className="px-2">
                        <button type="button" onClick={() => setOpen(open === id ? null : id)} className="text-gray-500" aria-label="expand">
                          <span className="material-symbols-outlined text-[18px]">{open === id ? "expand_less" : "expand_more"}</span>
                        </button>
                      </td>
                    )}
                    {fields.map((f) => (
                      <td key={f.key} className="px-3 py-1.5">
                        {f.readOnlyAfterCreate ? (
                          <code className="text-xs text-gray-500">{r[f.key]}</code>
                        ) : f.type === "bool" ? (
                          <input type="checkbox" checked={Boolean(r[f.key])} disabled={busy === id}
                                 onChange={(e) => update(id, { [f.key]: e.target.checked })} />
                        ) : f.type === "select" ? (
                          <select defaultValue={r[f.key] ?? ""} disabled={busy === id} className={cell}
                                  onChange={(e) => update(id, { [f.key]: e.target.value || null })}>
                            <option value="">—</option>
                            {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input
                            defaultValue={r[f.key] ?? ""}
                            type={f.type === "number" ? "number" : "text"}
                            disabled={busy === id}
                            className={`${cell} ${f.width ?? "w-40"}`}
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              const v = f.type === "number" ? (raw === "" ? null : Number(raw)) : raw || null;
                              if (v !== (r[f.key] ?? null)) update(id, { [f.key]: v });
                            }}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                  {renderBelow && open === id && (
                    <tr>
                      <td colSpan={fields.length + 1} className="bg-gray-50 px-4 py-3">{renderBelow(r)}</td>
                    </tr>
                  )}
                </FragmentRow>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={fields.length + 1} className="px-4 py-4 text-sm text-gray-400">—</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t bg-gray-50 p-3">
        {fields.map((f) => (
          <label key={f.key} className="text-[11px] text-gray-500">
            {f.label}
            {f.type === "bool" ? (
              <input type="checkbox" className="ms-1 block" checked={Boolean(draft[f.key])}
                     onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked }))} />
            ) : f.type === "select" ? (
              <select className={`${cell} block`} value={draft[f.key] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}>
                <option value="">—</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input type={f.type === "number" ? "number" : "text"} className={`${cell} block ${f.width ?? "w-40"}`}
                     value={draft[f.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
            )}
          </label>
        ))}
        <button type="button" disabled={busy === "add"} onClick={add}
                className="rounded bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {addLabel}
        </button>
      </div>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
