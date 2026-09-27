"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// أفعال اللقطات (§42 · §45 · §66).
//
// القاعدة هي الحارس: crm_run_snapshot ترفض إعادة البناء لغير المدير
// وبلا سبب، وترفض يوماً لم ينتهِ، ولا تكرّر يوماً مأخوذاً. الأزرار هنا
// تُظهر ما يسمح به الدور وتنقل رسالة القاعدة كما هي.
// ============================================================

export function RunSnapshotButton({ date, label, retry }: { date: string; label?: string; retry?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("crm_run_snapshot", { p_date: date, p_trigger: "manual", p_reason: retry ? "إعادة محاولة يدوية" : null, p_force: false });
    setBusy(false);
    if (error) return setMsg(error.message);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={run} disabled={busy}
              className={retry ? "text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
                               : "rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"}>
        {busy ? "يعمل…" : label ?? "شغّل الآن"}
      </button>
      {msg && <span className="text-xs text-red-700">{msg}</span>}
    </span>
  );
}

export function RebuildForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [date, setDate] = useState(defaultDate);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function rebuild() {
    if (!reason.trim()) return setMsg("السبب مطلوب — يُحفظ مع التشغيل ويظهر في «الأصل والمصحَّح».");
    if (!confirm(`إعادة بناء لقطة ${date}؟ الأصل يبقى محفوظاً للمقارنة.`)) return;
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("crm_run_snapshot", { p_date: date, p_trigger: "rebuild", p_reason: reason.trim(), p_force: true });
    setBusy(false);
    if (error) return setMsg(error.message);
    setReason("");
    setMsg("أُعيد البناء.");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="block">
        <span className="text-xs text-gray-500">اليوم</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 block rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
      </label>
      <label className="block flex-1">
        <span className="text-xs text-gray-500">السبب (مطلوب)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: تصحيح مرحلة سُجّلت خطأً يوم ٢٠"
               className="mt-1 block w-full min-w-[16rem] rounded border border-gray-300 px-2 py-1.5" />
      </label>
      <button type="button" onClick={rebuild} disabled={busy} className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
        {busy ? "يعيد البناء…" : "أعد البناء"}
      </button>
      {msg && <p className="w-full text-xs text-gray-700">{msg}</p>}
    </div>
  );
}

export function BackfillForm({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("crm_backfill_snapshots", { p_from: a, p_to: b, p_reason: "استدراك يدوي من عمليات اللقطات" });
    setBusy(false);
    if (error) {
      return setMsg(error.message.includes("timeout")
        ? "المدى أطول من مهلة الطلب — جزّئه (١٥ يوماً في المرة تكفي عادةً). ما اكتمل منه حُفظ."
        : error.message);
    }
    setMsg(`أُخذت ${(data as unknown[] | null)?.length ?? 0} لقطة. الأيام المأخوذة سلفاً لم تُمسّ.`);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="block"><span className="text-xs text-gray-500">من</span>
        <input type="date" value={a} onChange={(e) => setA(e.target.value)} className="mt-1 block rounded border border-gray-300 px-2 py-1.5" dir="ltr" /></label>
      <label className="block"><span className="text-xs text-gray-500">إلى</span>
        <input type="date" value={b} onChange={(e) => setB(e.target.value)} className="mt-1 block rounded border border-gray-300 px-2 py-1.5" dir="ltr" /></label>
      <button type="button" onClick={go} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
        {busy ? "يستدرك…" : "استدرك الأيام الناقصة"}
      </button>
      {msg && <p className="w-full text-xs text-gray-700">{msg}</p>}
    </div>
  );
}

export function ResyncFacts() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function go(all: boolean) {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const since = all ? null : new Date(Date.now() - 7 * 86400000).toISOString();
    const { data, error } = await supabase.rpc("crm_fact_resync", { p_since: since });
    setBusy(false);
    if (error) return setMsg(error.message);
    const rows = (data ?? []) as { source: string; synced: number }[];
    setMsg(`أُعيدت مزامنة ${rows.reduce((n, r) => n + Number(r.synced), 0)} صفّاً.`);
    router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <button type="button" onClick={() => go(false)} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
        {busy ? "يزامن…" : "أعد مزامنة آخر ٧ أيام"}
      </button>
      <button type="button" onClick={() => go(true)} disabled={busy} className="text-xs text-gray-500 hover:underline disabled:opacity-50">الكل</button>
      {msg && <span className="text-xs text-gray-700">{msg}</span>}
    </span>
  );
}
