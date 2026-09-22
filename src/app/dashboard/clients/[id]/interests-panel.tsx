"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { UNIT_TYPES } from "@/lib/types";
import type { ClientInterest, ProjectLite } from "@/lib/crm";

// ============================================================
// الاهتمامات العقارية — العميل يهتم بأكثر من وحدة (sql/072).
//
// الاهتمام ليس فرصة: «يريد شقة ٣ غرف في الكرادة بأقل من ٢٠٠ مليون»
// رغبةٌ تُطابَق عليها الوحدات (match_units_for_client)، والفرصة
// تُفتح حين تتحدّد الصفقة. لذلك يُسجَّل الاهتمام بلا مشروع أحياناً.
// ============================================================
const STATUSES = ["مهتم", "عُرِض عليه", "استُبعد", "محجوز", "مباع"];

export default function InterestsPanel({
  clientId,
  interests,
  projects,
}: {
  clientId: string;
  interests: ClientInterest[];
  projects: ProjectLite[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    project_id: "",
    unit_type: "",
    rooms: "",
    area_min: "",
    area_max: "",
    budget_min: "",
    budget_max: "",
    purpose: "",
    notes: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  async function add() {
    setErr(null);
    if (!f.project_id && !f.unit_type && !f.budget_max && !f.area_max) {
      return setErr("حدّد شيئاً واحداً على الأقل: مشروع أو نوع أو ميزانية أو مساحة.");
    }
    setBusy("add");
    const { error } = await supabase.from("client_interests").insert({
      client_id: clientId,
      project_id: f.project_id || null,
      unit_type: f.unit_type || null,
      rooms: num(f.rooms),
      area_min: num(f.area_min),
      area_max: num(f.area_max),
      budget_min: num(f.budget_min),
      budget_max: num(f.budget_max),
      purpose: f.purpose || null,
      notes: f.notes.trim() || null,
      priority: interests.length + 1,
    });
    setBusy(null);
    if (error) return setErr(error.message);
    setOpen(false);
    setF({ project_id: "", unit_type: "", rooms: "", area_min: "", area_max: "", budget_min: "", budget_max: "", purpose: "", notes: "" });
    router.refresh();
  }

  async function setStatus(id: string, status: string) {
    setBusy(id);
    const { error } = await supabase.from("client_interests").update({ status }).eq("id", id);
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  const fmt = (n: number | null) => (n === null ? "…" : Number(n).toLocaleString("en-US"));

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500">الاهتمامات العقارية</p>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs text-brand-600 hover:underline">
          {open ? "إغلاق" : "+ اهتمام"}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}

      {interests.length === 0 && !open && (
        <p className="mt-2 text-sm text-gray-400">لا اهتمامات مسجَّلة — سجّل ما يبحث عنه لتُقترح له وحدات.</p>
      )}

      {interests.length > 0 && (
        <ul className="mt-2 divide-y divide-gray-100">
          {interests.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-medium text-gray-800">
                {i.projects?.name ?? "أي مشروع"}
                {i.units?.unit_code ? ` / ${i.units.unit_code}` : ""}
              </span>
              <span className="text-gray-500">
                {[
                  i.unit_type,
                  i.rooms ? `${i.rooms} غرف` : null,
                  i.area_min || i.area_max ? `${fmt(i.area_min)}–${fmt(i.area_max)} م²` : null,
                  i.budget_min || i.budget_max ? `${fmt(i.budget_min)}–${fmt(i.budget_max)}` : null,
                  i.purpose,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <select
                value={i.status}
                disabled={busy === i.id}
                onChange={(e) => setStatus(i.id, e.target.value)}
                className={`ms-auto rounded border px-2 py-0.5 text-xs ${
                  i.status === "مهتم" ? "border-brand-300 text-brand-700" : i.status === "استُبعد" ? "border-gray-300 text-gray-400" : "border-amber-300 text-amber-700"
                }`}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {i.notes && <p className="w-full text-xs text-gray-400">{i.notes}</p>}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-3 grid gap-2 border-t pt-3 text-sm sm:grid-cols-3">
          <select value={f.project_id} onChange={(e) => set("project_id", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5">
            <option value="">أي مشروع</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={f.unit_type} onChange={(e) => set("unit_type", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5">
            <option value="">أي نوع</option>
            {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="number" placeholder="غرف" value={f.rooms} onChange={(e) => set("rooms", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
          <input type="number" placeholder="مساحة من" value={f.area_min} onChange={(e) => set("area_min", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
          <input type="number" placeholder="مساحة إلى" value={f.area_max} onChange={(e) => set("area_max", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
          <select value={f.purpose} onChange={(e) => set("purpose", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5">
            <option value="">الغرض</option>
            <option value="سكن">سكن</option>
            <option value="استثمار">استثمار</option>
          </select>
          <input type="number" placeholder="ميزانية من" value={f.budget_min} onChange={(e) => set("budget_min", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
          <input type="number" placeholder="ميزانية إلى" value={f.budget_max} onChange={(e) => set("budget_max", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
          <input placeholder="ملاحظة" value={f.notes} onChange={(e) => set("notes", e.target.value)} className="rounded border border-gray-300 px-2 py-1.5" />
          <div className="flex gap-2 sm:col-span-3">
            <button type="button" disabled={busy === "add"} onClick={add} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              أضف
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600">
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
