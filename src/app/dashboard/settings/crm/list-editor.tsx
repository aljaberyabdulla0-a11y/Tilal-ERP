"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// محرّر قائمة مرجعية — يخدم المصادر وأسباب الخسارة معاً.
//
// لا حذف: صفٌّ مرجعي قد تشير إليه صفقات وعملاء، وحذفه يترك
// مراجع معلّقة أو يمحو تاريخاً. التعطيل يخفيه من القوائم فقط.
// ============================================================
type Row = {
  id: string;
  name: string;
  category: string | null;
  is_active: boolean;
  sort_order: number;
  requires_note?: boolean;
};

export default function ListEditor({
  table,
  rows,
  categories,
  withNote,
}: {
  table: "crm_sources" | "crm_lost_reasons" | "crm_tags";
  rows: Row[];
  categories: string[];
  withNote?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    const n = name.trim().replace(/\s+/g, " ");
    if (!n) return setErr("اكتب الاسم.");
    if (rows.some((r) => r.name === n)) return setErr("موجود بالاسم نفسه.");
    setBusy("add");
    setErr(null);
    const maxOrder = rows.reduce((m, r) => Math.max(m, Number(r.sort_order)), 0);
    const { error } = await supabase
      .from(table)
      .insert(
        categories.length > 0
          ? { name: n, category, sort_order: maxOrder + 10 }
          : { name: n, sort_order: maxOrder + 10 }
      );
    setBusy(null);
    if (error) return setErr(error.message);
    setName("");
    router.refresh();
  }

  async function update(id: string, patch: Partial<Row>) {
    setBusy(id);
    setErr(null);
    const { error } = await supabase.from(table).update(patch).eq("id", id);
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {err && <p className="border-b bg-red-50 px-4 py-2 text-xs text-red-700">{err}</p>}
      <ul className="divide-y divide-gray-100">
        {rows.map((r) => (
          <li key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-2 text-sm ${r.is_active ? "" : "opacity-50"}`}>
            <span className="flex-1 font-medium text-gray-800">{r.name}</span>
            {/* بلا تصنيفات (الوسوم مثلاً): لا تُعرض قائمة فارغة */}
            {categories.length > 0 && (
              <select
                value={r.category ?? ""}
                disabled={busy === r.id}
                onChange={(e) => update(r.id, { category: e.target.value || null })}
                className="rounded border border-gray-300 px-2 py-1 text-xs"
              >
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            {withNote && (
              <label className="flex items-center gap-1 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={r.requires_note ?? false}
                  disabled={busy === r.id}
                  onChange={(e) => update(r.id, { requires_note: e.target.checked })}
                />
                يتطلّب توضيحاً
              </label>
            )}
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={r.is_active}
                disabled={busy === r.id}
                onChange={(e) => update(r.id, { is_active: e.target.checked })}
              />
              فعّال
            </label>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-4 text-sm text-gray-400">لا عناصر.</li>}
      </ul>
      <div className="flex gap-2 border-t bg-gray-50 p-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="اسم جديد"
          className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        {categories.length > 0 && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          disabled={busy === "add"}
          onClick={add}
          className="rounded bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          أضف
        </button>
      </div>
    </div>
  );
}
