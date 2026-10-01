"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { UNIT_STATUS_COLORS, Unit, formatPrice } from "@/lib/types";

// قائمة اختيار الوحدات — الحفظ يُضيف ما اختير ويحذف ما أُزيل، فقط
export default function UnitPicker({
  companyId,
  units,
  initialSelected,
}: {
  companyId: string;
  units: Unit[];
  initialSelected: string[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return units;
    return units.filter((u) =>
      [u.unit_code, u.node_path, u.unit_type].some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [units, query]);

  const dirty =
    selected.size !== initialSelected.length ||
    initialSelected.some((id) => !selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAll(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      shown.forEach((u) => (on ? next.add(u.id) : next.delete(u.id)));
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    const before = new Set(initialSelected);
    const added = Array.from(selected).filter((id) => !before.has(id));
    const removed = initialSelected.filter((id) => !selected.has(id));

    if (removed.length) {
      const { error } = await supabase
        .from("broker_visible_units")
        .delete()
        .eq("company_id", companyId)
        .in("unit_id", removed);
      if (error) {
        setBusy(false);
        setMessage({ ok: false, text: "تعذّر الحفظ: " + error.message });
        return;
      }
    }
    if (added.length) {
      const { error } = await supabase
        .from("broker_visible_units")
        .insert(added.map((unit_id) => ({ company_id: companyId, unit_id })));
      if (error) {
        setBusy(false);
        setMessage({ ok: false, text: "تعذّر الحفظ: " + error.message });
        return;
      }
    }

    setBusy(false);
    setMessage({ ok: true, text: `حُفظ — ${selected.size} وحدة ظاهرة للشركة في هذا المشروع.` });
    router.refresh();
  }

  return (
    <div className="glass-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث برقم الوحدة أو الموقع أو النوع"
          className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gray-500">
            مختارة {selected.size} من {units.length}
          </span>
          <button onClick={() => setAll(true)} className="font-semibold text-brand-700 hover:underline">
            اختر الظاهر
          </button>
          <button onClick={() => setAll(false)} className="text-gray-500 hover:underline">
            أزل الظاهر
          </button>
        </div>
      </div>

      {units.length === 0 ? (
        <p className="p-6 text-center text-gray-500">لا وحدات متاحة أو محجوزة في هذا المشروع.</p>
      ) : (
        <div className="max-h-[60vh] divide-y overflow-y-auto rounded-xl border">
          {shown.map((u) => (
            <label
              key={u.id}
              className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={selected.has(u.id)}
                onChange={() => toggle(u.id)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <b className="min-w-[70px] text-gray-800">{u.unit_code ?? "—"}</b>
              <span className="text-gray-500">{u.node_path ?? ""}</span>
              <span className="text-gray-500">{u.unit_type}</span>
              {u.space_m2 && <span className="text-gray-500">{u.space_m2} م²</span>}
              <span className="ms-auto text-gray-700" dir="ltr">
                {formatPrice(u.price)}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${UNIT_STATUS_COLORS[u.status] ?? ""}`}>
                {u.status}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "جارٍ الحفظ..." : "حفظ الاختيار"}
        </button>
        {message && (
          <span className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
