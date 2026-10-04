"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// نموذج سجلٍّ عام لقسم التسويق — إدخال أو تعديل صفٍّ في جدول.
//
// ⚠️ التحقّق هنا تكميليّ: يمنع الإرسال الفارغ ويُفهم الخطأ، والحكم
//    في القاعدة (RLS + حرّاس 121–124). رسالة الحارس عربيةٌ مكتوبة
//    لتُعرض كما هي — «اعتماد الحملة لمدير التسويق» أوضح من أي ترجمة.
// ============================================================

export type FieldSpec = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date" | "datetime" | "select" | "checkbox" | "tags";
  options?: { value: string; label: string }[] | readonly string[];
  required?: boolean;
  span?: 1 | 2 | 3;
  placeholder?: string;
  ltr?: boolean;
  hint?: string;
};

type Values = Record<string, string | boolean>;

function initialValues(fields: FieldSpec[], initial: Record<string, unknown>): Values {
  const v: Values = {};
  for (const f of fields) {
    const raw = initial[f.name];
    if (f.type === "checkbox") v[f.name] = Boolean(raw);
    else if (f.type === "tags") v[f.name] = Array.isArray(raw) ? (raw as string[]).join("، ") : "";
    else if (f.type === "datetime" && typeof raw === "string") v[f.name] = raw.slice(0, 16);
    else v[f.name] = raw === null || raw === undefined ? "" : String(raw);
  }
  return v;
}

export function friendlyError(msg: string, code?: string): string {
  if (code === "23505") return "قيمة مكرّرة — يوجد سجلٌّ بنفس الاسم أو الرمز.";
  if (code === "23514") return "قيمة خارج المسموح (تاريخ نهاية قبل البداية، أو رقم سالب، أو صيغة خاطئة).";
  if (code === "42501") return "ليست من صلاحيتك.";
  return msg;
}

export default function RecordForm({
  table,
  fields,
  id,
  initial = {},
  fixed = {},
  title,
  submitLabel = "احفظ",
  openLabel,
  openIcon = "add",
  redirectTo,
  onSavedRedirectWithId,
  startOpen = false,
  returnsId = true,
}: {
  table: string;
  fields: FieldSpec[];
  id?: string;
  initial?: Record<string, unknown>;
  fixed?: Record<string, unknown>;
  title?: string;
  submitLabel?: string;
  openLabel?: string;
  openIcon?: string;
  redirectTo?: string;
  /** بعد الإدخال: يُفتح سجلّه — `${prefix}${id}` */
  onSavedRedirectWithId?: string;
  startOpen?: boolean;
  /** جدولٌ بمفتاح مركّب بلا عمود id (ربطٌ بين جدولين) */
  returnsId?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen || !openLabel);
  const [values, setValues] = useState<Values>(() => initialValues(fields, initial));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (k: string, v: string | boolean) => {
    setSaved(false);
    setValues((p) => ({ ...p, [k]: v }));
  };

  async function save() {
    setErr(null);
    const payload: Record<string, unknown> = { ...fixed };
    for (const f of fields) {
      const v = values[f.name];
      if (f.required && (v === "" || v === undefined)) {
        return setErr(`«${f.label}» مطلوب.`);
      }
      if (f.type === "checkbox") payload[f.name] = Boolean(v);
      else if (f.type === "number") {
        if (v === "") payload[f.name] = null;
        else {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) return setErr(`«${f.label}» رقمٌ موجب.`);
          payload[f.name] = n;
        }
      } else if (f.type === "tags") {
        payload[f.name] = String(v).split(/[،,]/).map((s) => s.trim()).filter(Boolean);
      } else if (f.type === "datetime") {
        payload[f.name] = v ? new Date(String(v)).toISOString() : null;
      } else {
        payload[f.name] = typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v;
      }
    }

    setBusy(true);
    const supabase = createClient();
    const cols = returnsId ? "id" : "*";
    const res = id
      ? await supabase.from(table).update(payload).eq("id", id).select(cols)
      : await supabase.from(table).insert(payload).select(cols);
    setBusy(false);

    if (res.error) return setErr(friendlyError(res.error.message, res.error.code));
    // RLS تمنع التعديل صمتاً — صفر صفوف بلا خطأ (084). نقولها لا نُخفيها.
    if (!res.data || res.data.length === 0) return setErr("لم يُحفظ شيء — ليست من صلاحيتك.");

    const newId = (res.data[0] as unknown as { id?: string }).id ?? "";
    if (onSavedRedirectWithId && !id) {
      router.push(`${onSavedRedirectWithId}${newId}`);
      return;
    }
    if (redirectTo) {
      router.push(redirectTo);
      return;
    }
    setSaved(true);
    if (!id) {
      setValues(initialValues(fields, initial));
      if (openLabel) setOpen(false);
    }
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3.5 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
      >
        <span className="material-symbols-outlined text-[18px]">{openIcon}</span>
        {openLabel}
      </button>
    );
  }

  const opts = (o: FieldSpec["options"]) =>
    (o ?? []).map((x) => (typeof x === "string" ? { value: x, label: x } : x));

  return (
    <div className="rounded-lg border border-brand-200 bg-white p-4">
      {title && <p className="mb-3 font-semibold text-gray-800">{title}</p>}
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        {fields.map((f) => {
          const span = f.span === 3 ? "sm:col-span-3" : f.span === 2 ? "sm:col-span-2" : "";
          const common = "mt-1 w-full rounded border border-gray-300 px-2 py-1.5 focus:border-brand-500 focus:outline-none";
          const v = values[f.name];
          return (
            <label key={f.name} className={`block ${span}`}>
              <span className="text-xs text-gray-500">
                {f.label}{f.required && <span className="text-red-500"> *</span>}
              </span>
              {f.type === "textarea" ? (
                <textarea value={String(v)} onChange={(e) => set(f.name, e.target.value)} rows={3}
                  placeholder={f.placeholder} className={common} />
              ) : f.type === "select" ? (
                <select value={String(v)} onChange={(e) => set(f.name, e.target.value)} className={common}>
                  {!f.required && <option value="">—</option>}
                  {f.required && v === "" && <option value="">اختر…</option>}
                  {opts(f.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === "checkbox" ? (
                <span className="mt-2 flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(f.name, e.target.checked)} />
                  <span className="text-xs text-gray-600">{f.placeholder ?? "نعم"}</span>
                </span>
              ) : (
                <input
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text"}
                  value={String(v)}
                  onChange={(e) => set(f.name, e.target.value)}
                  placeholder={f.placeholder}
                  dir={f.ltr || f.type === "number" || f.type === "date" || f.type === "datetime" ? "ltr" : undefined}
                  className={common}
                />
              )}
              {f.hint && <span className="mt-0.5 block text-[11px] text-gray-400">{f.hint}</span>}
            </label>
          );
        })}

        {err && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700 sm:col-span-3">{err}</p>}
        {saved && <p className="text-xs text-brand-700 sm:col-span-3">حُفظ.</p>}
        <div className="flex gap-2 sm:col-span-3">
          <button type="button" disabled={busy} onClick={save}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? "يحفظ…" : submitLabel}
          </button>
          {openLabel && (
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600">
              إلغاء
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
