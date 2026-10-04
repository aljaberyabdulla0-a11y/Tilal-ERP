"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "./record-form";

// ============================================================
// أزرار الإجراءات — كلٌّ يستدعي دالّةً في القاعدة (RPC) أو يغيّر
// عموداً واحداً. المنطق كله هناك: الاعتماد، الدفع، الإلغاء، الصرف.
// والزرّ يعرض رسالة الحارس كما هي حين يرفض.
// ============================================================

export function RpcButton({
  fn,
  args,
  label,
  icon,
  confirm,
  prompt,
  promptKey,
  promptRequired = false,
  tone = "brand",
  redirectTo,
  small = false,
}: {
  fn: string;
  args: Record<string, unknown>;
  label: string;
  icon?: string;
  confirm?: string;
  /** يُطلب نصٌّ قبل التنفيذ (سبب الرفض أو الإلغاء) ويُمرَّر في promptKey */
  prompt?: string;
  promptKey?: string;
  promptRequired?: boolean;
  tone?: "brand" | "danger" | "plain";
  redirectTo?: string;
  small?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setErr(null);
    const a = { ...args };
    if (prompt && promptKey) {
      const v = window.prompt(prompt) ?? null;
      if (v === null) return;
      if (promptRequired && !v.trim()) return setErr("مطلوب.");
      a[promptKey] = v.trim() || null;
    } else if (confirm && !window.confirm(confirm)) {
      return;
    }
    setBusy(true);
    const { error } = await createClient().rpc(fn, a);
    setBusy(false);
    if (error) return setErr(friendlyError(error.message, error.code));
    if (redirectTo) router.push(redirectTo);
    else router.refresh();
  }

  const cls =
    tone === "danger"
      ? "border-red-300 text-red-700 hover:bg-red-50"
      : tone === "plain"
      ? "border-gray-300 text-gray-700 hover:bg-gray-50"
      : "border-brand-600 bg-brand-600 text-white hover:bg-brand-700";

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        disabled={busy}
        onClick={run}
        className={`inline-flex items-center gap-1 rounded-lg border font-semibold transition disabled:opacity-50 ${cls} ${small ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"}`}
      >
        {icon && <span className={`material-symbols-outlined ${small ? "text-[15px]" : "text-[18px]"}`}>{icon}</span>}
        {busy ? "…" : label}
      </button>
      {err && <span className="mt-1 max-w-xs text-xs text-red-700">{err}</span>}
    </span>
  );
}

export function FieldSelect({
  table,
  id,
  column,
  value,
  options,
  small = true,
}: {
  table: string;
  id: string;
  column: string;
  value: string | null;
  options: readonly string[];
  small?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(value ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    const prev = v;
    setV(next);
    setErr(null);
    setBusy(true);
    const { data, error } = await createClient().from(table).update({ [column]: next || null }).eq("id", id).select("id");
    setBusy(false);
    if (error || !data?.length) {
      setV(prev);
      setErr(error ? friendlyError(error.message, error.code) : "ليست من صلاحيتك.");
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col">
      <select
        value={v}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className={`rounded border border-gray-300 bg-white ${small ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm"}`}
      >
        {!options.includes(v) && <option value={v}>{v || "—"}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {err && <span className="mt-1 max-w-xs text-xs text-red-700">{err}</span>}
    </span>
  );
}

export function DeleteRow({ table, id, label = "حذف", confirm = "حذف نهائي؟" }: { table: string; id: string; label?: string; confirm?: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    if (!window.confirm(confirm)) return;
    const { data, error } = await createClient().from(table).delete().eq("id", id).select("id");
    if (error || !data?.length) return setErr(error ? friendlyError(error.message, error.code) : "ليست من صلاحيتك.");
    router.refresh();
  }
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={run} className="text-xs text-red-600 hover:underline">{label}</button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}

export function ToggleField({ table, id, column, value, on = "فعّال", off = "موقوف" }: {
  table: string; id: string; column: string; value: boolean; on?: string; off?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  async function flip() {
    const next = !v;
    setV(next);
    const { data, error } = await createClient().from(table).update({ [column]: next }).eq("id", id).select("id");
    if (error || !data?.length) {
      setV(!next);
      return setErr(error ? friendlyError(error.message, error.code) : "ليست من صلاحيتك.");
    }
    router.refresh();
  }
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={flip}
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${v ? "bg-brand-100 text-brand-700" : "bg-gray-100 text-gray-500"}`}>
        {v ? on : off}
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}
