"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type SavedView = {
  id: string;
  user_id: string;
  name: string;
  entity: string;
  filters: Record<string, string>;
  is_shared: boolean;
  is_default: boolean;
};

// ============================================================
// العروض المحفوظة — المُرشِّح باسمٍ يُنقر (§46 · sql/080).
//
// المُرشِّح يعيش في عنوان الصفحة (?filter=…&temperature=…)، فالحفظ
// هو حفظ العنوان باسم: «ليداتي الساخنة»، «بلا مالك». والمشترك يراه
// الفريق كله لكن صاحبه وحده يحذفه — لا أحد يُسقط عرضاً يعتمد عليه
// غيره (سياسة القاعدة تفرض ذلك، والزرّ يخفيه فقط).
// ============================================================
export default function SavedViews({
  entity,
  basePath,
  current,
  views,
  userId,
}: {
  entity: "clients" | "opportunities";
  basePath: string;
  current: Record<string, string>;   // المُرشِّحات الفعّالة الآن (بلا فراغات)
  views: SavedView[];
  userId: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasFilters = Object.keys(current).length > 0;
  const href = (f: Record<string, string>) => {
    const p = new URLSearchParams(f).toString();
    return p ? `${basePath}?${p}` : basePath;
  };
  const same = (a: Record<string, string>, b: Record<string, string>) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

  async function save() {
    const n = name.trim();
    if (!n) return setErr("اسمٌ للعرض.");
    setSaving(true);
    setErr(null);
    const { error } = await supabase
      .from("crm_saved_views")
      .insert({ name: n, entity, filters: current, is_shared: shared });
    setSaving(false);
    if (error) return setErr(error.code === "23505" ? "عندك عرض بهذا الاسم." : error.message);
    setName("");
    setOpen(false);
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("حذف هذا العرض؟")) return;
    await supabase.from("crm_saved_views").delete().eq("id", id);
    router.refresh();
  }

  if (views.length === 0 && !hasFilters) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      {views.map((v) => {
        const active = same(v.filters ?? {}, current);
        return (
          <span key={v.id} className="inline-flex items-center">
            <Link
              href={href(v.filters ?? {})}
              className={
                active
                  ? "rounded-s-full bg-brand-600 px-3 py-1 text-white"
                  : "rounded-s-full border border-e-0 border-gray-300 bg-white px-3 py-1 text-gray-700 hover:border-brand-600"
              }
              title={v.is_shared ? "عرض مشترك" : "عرضي"}
            >
              {v.is_shared && <span className="material-symbols-outlined me-1 align-middle text-[14px]">group</span>}
              {v.name}
            </Link>
            {v.user_id === userId ? (
              <button
                type="button"
                onClick={() => remove(v.id)}
                aria-label="حذف العرض"
                className={`rounded-e-full border px-1.5 py-1 text-[12px] ${active ? "border-brand-600 bg-brand-600 text-white/80" : "border-gray-300 bg-white text-gray-400 hover:text-red-600"}`}
              >
                ✕
              </button>
            ) : (
              <span className={`rounded-e-full border border-s-0 px-1.5 py-1 ${active ? "border-brand-600 bg-brand-600" : "border-gray-300 bg-white"}`} />
            )}
          </span>
        );
      })}

      {hasFilters && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-dashed border-gray-400 px-3 py-1 text-gray-600 hover:border-brand-600 hover:text-brand-600"
        >
          + احفظ هذا العرض
        </button>
      )}

      {open && (
        <span className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="اسم العرض"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            autoFocus
          />
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            للفريق
          </label>
          <button type="button" disabled={saving} onClick={save} className="rounded bg-brand-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
            حفظ
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500">
            إلغاء
          </button>
          {err && <span className="text-xs text-red-700">{err}</span>}
        </span>
      )}
    </div>
  );
}
