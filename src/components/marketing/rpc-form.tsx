"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, type FieldSpec } from "./record-form";

// ============================================================
// نموذجٌ يستدعي دالّة — كل حقلٍ معاملٌ بنفس اسمه (p_…).
// للأفعال التي لا تُكتب في جدول مباشرة: الصرف، تسجيل الشراء، اللمسة،
// مفتاح التكامل. الدالّة تتحقّق وتقرّر؛ النموذج يجمع ويعرض الرفض.
// ============================================================
export default function RpcForm({
  fn, fields, fixed = {}, submitLabel = "نفّذ", openLabel, compact = false, resultMessage,
}: {
  fn: string;
  fields: FieldSpec[];
  fixed?: Record<string, unknown>;
  submitLabel?: string;
  openLabel?: string;
  compact?: boolean;
  /** تُعرض بعد النجاح؛ {result} تُستبدل بما أرجعته الدالّة */
  resultMessage?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!openLabel);
  const [vals, setVals] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((f) => [f.name, ""])) as Record<string, string>
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setErr(null);
    setMsg(null);
    const args: Record<string, unknown> = { ...fixed };
    for (const f of fields) {
      const v = vals[f.name]?.trim() ?? "";
      if (f.required && !v) return setErr(`«${f.label}» مطلوب.`);
      if (f.type === "number") {
        if (v === "") args[f.name] = null;
        else if (!Number.isFinite(Number(v))) return setErr(`«${f.label}» رقم.`);
        else args[f.name] = Number(v);
      } else if (f.type === "datetime") args[f.name] = v ? new Date(v).toISOString() : null;
      else args[f.name] = v || null;
    }
    setBusy(true);
    const { data, error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) return setErr(friendlyError(error.message, error.code));
    setVals(Object.fromEntries(fields.map((f) => [f.name, ""])));
    if (resultMessage) setMsg(resultMessage.replace("{result}", typeof data === "object" ? JSON.stringify(data) : String(data ?? "")));
    if (openLabel && !resultMessage) setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100">
        {openLabel}
      </button>
    );
  }

  const opts = (o: FieldSpec["options"]) => (o ?? []).map((x) => (typeof x === "string" ? { value: x, label: x } : x));
  const inp = "mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5";
  return (
    <div className={compact ? "w-72 rounded-lg border border-brand-200 bg-white p-3 text-xs shadow-lg" : "text-sm"}>
      <div className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-3"}>
        {fields.map((f) => (
          <label key={f.name} className={`block ${!compact && f.span === 3 ? "sm:col-span-3" : !compact && f.span === 2 ? "sm:col-span-2" : ""}`}>
            <span className="text-xs text-gray-500">{f.label}{f.required && <span className="text-red-500"> *</span>}</span>
            {f.type === "select" ? (
              <select value={vals[f.name]} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} className={inp}>
                <option value="">{f.required ? "اختر…" : "—"}</option>
                {opts(f.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === "textarea" ? (
              <textarea value={vals[f.name]} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} rows={3} className={inp} placeholder={f.placeholder} />
            ) : (
              <input
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text"}
                value={vals[f.name]} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}
                dir={f.ltr || f.type === "number" || f.type === "date" ? "ltr" : undefined} placeholder={f.placeholder} className={inp} />
            )}
            {f.hint && <span className="mt-0.5 block text-[11px] text-gray-400">{f.hint}</span>}
          </label>
        ))}
      </div>
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
      {msg && <p className="mt-2 text-xs text-brand-700">{msg}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={run} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "…" : submitLabel}
        </button>
        {openLabel && <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-3 py-1.5 text-sm">إلغاء</button>}
      </div>
    </div>
  );
}
