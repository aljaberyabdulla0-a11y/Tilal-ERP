"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ATT_TYPES = ["تعديل بصمة", "مهمة رسمية", "عمل ميداني", "عمل عن بُعد", "رحلة عمل"];

// نموذجا الطلب: دوام (submit_attendance_request) وعمل إضافي (submit_overtime_request).
// القاعدة تتحقّق (المدى، الكشف المعتمد، التداخل) وتُدخل الطلب سلسلته.
export default function RequestForms({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [tab, setTab] = useState<"" | "att" | "ot">("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [a, setA] = useState({ type: "تعديل بصمة", start: "", end: "", in: "", out: "", reason: "" });
  const [o, setO] = useState({ date: "", start: "", end: "", reason: "", compensation: "أجر", project: "" });

  async function submitAtt(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const adjust = a.type === "تعديل بصمة";
    const { error } = await supabase.rpc("submit_attendance_request", {
      p_type: a.type,
      p_start: a.start,
      p_end: adjust ? a.start : a.end || a.start,
      p_reason: a.reason,
      p_check_in: adjust && a.in ? a.in : null,
      p_check_out: adjust && a.out ? a.out : null,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: "أُرسل الطلب إلى سلسلة الموافقة ✓" });
    setTab("");
    setA({ ...a, start: "", end: "", in: "", out: "", reason: "" });
    router.refresh();
  }

  async function submitOt(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.rpc("submit_overtime_request", {
      p_date: o.date, p_start: o.start, p_end: o.end, p_reason: o.reason,
      p_compensation: o.compensation, p_project: o.project || null,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: "أُرسل طلب العمل الإضافي ✓" });
    setTab("");
    setO({ ...o, date: "", start: "", end: "", reason: "" });
    router.refresh();
  }

  const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const label = "text-xs text-gray-600";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTab(tab === "att" ? "" : "att")}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">+ طلب دوام</button>
        <button onClick={() => setTab(tab === "ot" ? "" : "ot")}
          className="rounded-lg border px-4 py-2 text-sm text-brand-700 hover:bg-gray-50">+ عمل إضافي</button>
      </div>
      {msg && <p className={`rounded p-2 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

      {tab === "att" && (
        <form onSubmit={submitAtt} className="grid grid-cols-1 gap-3 rounded-2xl border bg-white p-5 shadow-sm sm:grid-cols-3">
          <label className={label}>
            النوع
            <select className={input} value={a.type} onChange={(e) => setA({ ...a, type: e.target.value })}>
              {ATT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className={label}>
            {a.type === "تعديل بصمة" ? "اليوم *" : "من *"}
            <input className={input} type="date" dir="ltr" required value={a.start} onChange={(e) => setA({ ...a, start: e.target.value })} />
          </label>
          {a.type === "تعديل بصمة" ? (
            <div className="grid grid-cols-2 gap-2">
              <label className={label}>الدخول<input className={input} type="time" dir="ltr" value={a.in} onChange={(e) => setA({ ...a, in: e.target.value })} /></label>
              <label className={label}>الانصراف<input className={input} type="time" dir="ltr" value={a.out} onChange={(e) => setA({ ...a, out: e.target.value })} /></label>
            </div>
          ) : (
            <label className={label}>
              إلى
              <input className={input} type="date" dir="ltr" min={a.start} value={a.end} onChange={(e) => setA({ ...a, end: e.target.value })} />
            </label>
          )}
          <label className={`${label} sm:col-span-3`}>
            السبب *
            <input className={input} required value={a.reason} onChange={(e) => setA({ ...a, reason: e.target.value })} />
          </label>
          <p className="text-[11px] text-gray-400 sm:col-span-3">
            {a.type === "تعديل بصمة"
              ? "بعد الاعتماد يُكتب سجلّ الدوام بالوقتين — لأيامٍ مضت خلال 31 يوماً."
              : "بعد الاعتماد تُعفى هذه الأيام من البصمة فلا تُحسب غياباً."}
          </p>
          <button disabled={busy} className="rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-3">إرسال</button>
        </form>
      )}

      {tab === "ot" && (
        <form onSubmit={submitOt} className="grid grid-cols-1 gap-3 rounded-2xl border bg-white p-5 shadow-sm sm:grid-cols-3">
          <label className={label}>اليوم *<input className={input} type="date" dir="ltr" required value={o.date} onChange={(e) => setO({ ...o, date: e.target.value })} /></label>
          <label className={label}>من *<input className={input} type="time" dir="ltr" required value={o.start} onChange={(e) => setO({ ...o, start: e.target.value })} /></label>
          <label className={label}>إلى *<input className={input} type="time" dir="ltr" required value={o.end} onChange={(e) => setO({ ...o, end: e.target.value })} /></label>
          <label className={label}>
            التعويض
            <select className={input} value={o.compensation} onChange={(e) => setO({ ...o, compensation: e.target.value })}>
              <option value="أجر">أجر</option>
              <option value="إجازة تعويضية">إجازة تعويضية</option>
            </select>
          </label>
          <label className={label}>
            المشروع
            <select className={input} value={o.project} onChange={(e) => setO({ ...o, project: e.target.value })}>
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className={label}>السبب *<input className={input} required value={o.reason} onChange={(e) => setO({ ...o, reason: e.target.value })} /></label>
          <p className="text-[11px] text-gray-400 sm:col-span-3">
            يُحسب الأجر في القاعدة بمعامل تحدّده الإدارة، ويُجمَّد لحظة الاعتماد. الإجازة التعويضية تُضاف إلى رصيدك.
          </p>
          <button disabled={busy} className="rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-3">إرسال</button>
        </form>
      )}
    </div>
  );
}
