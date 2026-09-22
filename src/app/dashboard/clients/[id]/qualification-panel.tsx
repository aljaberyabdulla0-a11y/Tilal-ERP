"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Client } from "@/lib/types";
import { UNIT_TYPES } from "@/lib/types";
import type { ProjectLite } from "@/lib/crm";

// ============================================================
// التأهيل — الأسئلة التي تفرّق الليد عن الفرصة (sql/074).
//
// أربع حقائق تُحرّك التأهيل: ميزانية، اهتمام عقاري، إطار زمني،
// صاحب قرار. ثلاث منها = «مؤهَّل». والدرجة تقرأ منها أيضاً
// (budget_known, project_selected …) فكل حقل يُملأ هنا يظهر أثره
// في بطاقة الدرجة بجانبه — لا حقل بلا عائد ظاهر.
//
// القيم المسموحة للإطار الزمني والإلحاح مقيّدة في القاعدة بـ check،
// فالقوائم هنا مرآة لها لا مصدر.
// ============================================================
const TIMELINES = ["فوري", "خلال ٣ أشهر", "خلال ٦ أشهر", "خلال سنة", "غير محدّد"];
const URGENCIES = ["عالية", "متوسطة", "منخفضة"];

export default function QualificationPanel({
  client,
  qualification,
  projects,
}: {
  client: Client;
  qualification: string | null;
  projects: ProjectLite[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    budget_min: client.budget_min?.toString() ?? "",
    budget_max: client.budget_max?.toString() ?? "",
    purchase_timeline: client.purchase_timeline ?? "",
    is_decision_maker: client.is_decision_maker ?? null,
    financing_required: client.financing_required ?? null,
    urgency: client.urgency ?? "",
    preferred_project_id: client.preferred_project_id ?? "",
    preferred_area: client.preferred_area ?? "",
    preferred_unit_type: client.preferred_unit_type ?? "",
  });

  const set = (k: keyof typeof f, v: string | boolean | null) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setErr(null);
    const min = f.budget_min.trim() === "" ? null : Number(f.budget_min);
    const max = f.budget_max.trim() === "" ? null : Number(f.budget_max);
    if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) {
      return setErr("الميزانية رقم.");
    }
    if (min !== null && max !== null && min > max) return setErr("الحدّ الأدنى أكبر من الأعلى.");

    setSaving(true);
    const { error } = await supabase
      .from("clients")
      .update({
        budget_min: min,
        budget_max: max,
        purchase_timeline: f.purchase_timeline || null,
        is_decision_maker: f.is_decision_maker,
        financing_required: f.financing_required,
        urgency: f.urgency || null,
        preferred_project_id: f.preferred_project_id || null,
        preferred_area: f.preferred_area.trim() || null,
        preferred_unit_type: f.preferred_unit_type || null,
      })
      .eq("id", client.id);
    if (!error) {
      // الدرجة تُعاد فوراً لهذا العميل وحده — ليرى الموظف أثر ما أدخل
      await supabase.rpc("refresh_lead_scores", { p_client_id: client.id });
    }
    setSaving(false);
    if (error) return setErr(error.message);
    setOpen(false);
    router.refresh();
  }

  const badge =
    qualification === "فرصة ساخنة"
      ? "bg-red-100 text-red-700"
      : qualification === "مؤهَّل"
        ? "bg-brand-100 text-brand-700"
        : qualification === "مؤهَّل جزئياً"
          ? "bg-amber-100 text-amber-700"
          : "bg-gray-100 text-gray-500";

  const summary: string[] = [];
  if (client.budget_min || client.budget_max) {
    summary.push(
      `ميزانية ${client.budget_min ? Number(client.budget_min).toLocaleString("en-US") : "…"} – ${
        client.budget_max ? Number(client.budget_max).toLocaleString("en-US") : "…"
      }`
    );
  }
  if (client.purchase_timeline) summary.push(client.purchase_timeline);
  if (client.preferred_unit_type) summary.push(client.preferred_unit_type);
  if (client.preferred_area) summary.push(client.preferred_area);
  if (client.is_decision_maker) summary.push("صاحب القرار");
  if (client.financing_required) summary.push("يحتاج تمويلاً");

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-gray-500">التأهيل</p>
          {qualification && <span className={`rounded px-2 py-0.5 text-xs font-semibold ${badge}`}>{qualification}</span>}
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs text-brand-600 hover:underline"
        >
          {open ? "إغلاق" : "تعديل"}
        </button>
      </div>

      {!open && (
        <p className="mt-2 text-sm text-gray-700">
          {summary.length > 0 ? summary.join(" · ") : (
            <span className="text-gray-400">لم يُملأ بعد — ميزانية وإطار زمني واهتمام عقاري تصنع الفرق بين ليد وفرصة.</span>
          )}
        </p>
      )}

      {open && (
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-gray-500">الميزانية من</span>
            <input type="number" value={f.budget_min} onChange={(e) => set("budget_min", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">إلى</span>
            <input type="number" value={f.budget_max} onChange={(e) => set("budget_max", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">الإطار الزمني للشراء</span>
            <select value={f.purchase_timeline} onChange={(e) => set("purchase_timeline", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
              <option value="">—</option>
              {TIMELINES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">الإلحاح</span>
            <select value={f.urgency} onChange={(e) => set("urgency", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
              <option value="">—</option>
              {URGENCIES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">المشروع المفضّل</span>
            <select value={f.preferred_project_id} onChange={(e) => set("preferred_project_id", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">نوع الوحدة المفضّل</span>
            <select value={f.preferred_unit_type} onChange={(e) => set("preferred_unit_type", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
              <option value="">—</option>
              {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs text-gray-500">المنطقة المفضّلة</span>
            <input value={f.preferred_area} onChange={(e) => set("preferred_area", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" />
          </label>
          <TriState label="صاحب القرار؟" value={f.is_decision_maker} onChange={(v) => set("is_decision_maker", v)} />
          <TriState label="يحتاج تمويلاً؟" value={f.financing_required} onChange={(v) => set("financing_required", v)} />

          {err && <p className="text-xs text-red-700 sm:col-span-2">{err}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {saving ? "يحفظ…" : "حفظ"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600">
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// نعم / لا / لا نعرف — «لا نعرف» قيمة مشروعة لا تُخلط بـ«لا»
function TriState({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  const opt = (v: boolean | null, txt: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      className={`rounded px-2 py-1 text-xs ${value === v ? "bg-brand-600 text-white" : "border border-gray-300 text-gray-600"}`}
    >
      {txt}
    </button>
  );
  return (
    <div>
      <span className="text-xs text-gray-500">{label}</span>
      <div className="mt-1 flex gap-1">
        {opt(true, "نعم")}
        {opt(false, "لا")}
        {opt(null, "لا نعرف")}
      </div>
    </div>
  );
}
