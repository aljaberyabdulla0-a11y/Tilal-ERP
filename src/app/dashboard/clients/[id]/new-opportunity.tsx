"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PAYMENT_METHODS } from "@/lib/types";
import type { ProjectLite, Stage } from "@/lib/crm";

type UnitLite = { id: string; unit_code: string | null; unit_type: string | null; price: number | null; status: string };

// ============================================================
// فتح فرصة من ملفّ العميل (sql/072).
//
// الفرصة = صفقة على مشروع (ووحدة اختيارياً) بقيمة متوقَّعة. العميل
// الواحد يفتح أكثر من فرصة — اشترى شقة ويفاوض على ثانية — وهو ما
// لم يكن clients.stage وحده يمثّله.
//
// ما لا نرسله يملؤه المحفّز prepare_opportunity: العنوان، والمالك
// (مالك العميل)، والاحتمال (احتمال المرحلة). نرسل الحدّ الأدنى ونترك
// القاعدة تُكمل — فلا تتباين فرصة أُنشئت من هنا عن أخرى من الحجز.
// ============================================================
export default function NewOpportunity({
  clientId,
  projects,
  stages,
  defaultProjectId,
  defaultPaymentMethod,
}: {
  clientId: string;
  projects: ProjectLite[];
  stages: Stage[];
  defaultProjectId?: string | null;
  defaultPaymentMethod?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [units, setUnits] = useState<UnitLite[]>([]);

  const openStages = stages.filter((s) => s.is_active && s.stage_type === "open");
  const [f, setF] = useState({
    project_id: defaultProjectId ?? "",
    unit_id: "",
    stage_id: openStages[0]?.id ?? "",
    expected_value: "",
    expected_close_date: "",
    payment_method: defaultPaymentMethod ?? "",
    notes: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  // وحدات المشروع المختار — المتاحة فقط؛ لا نعرض مباعاً لعميل جديد
  useEffect(() => {
    if (!open || !f.project_id) {
      setUnits([]);
      return;
    }
    supabase
      .from("units")
      .select("id,unit_code,unit_type,price,status")
      .eq("project_id", f.project_id)
      .eq("status", "متاحة")
      .order("unit_code")
      .limit(300)
      .then(({ data }) => setUnits((data ?? []) as UnitLite[]));
  }, [open, f.project_id, supabase]);

  // اختيار وحدة يملأ القيمة المتوقَّعة بسعرها إن كانت فارغة
  function pickUnit(id: string) {
    set("unit_id", id);
    const u = units.find((x) => x.id === id);
    if (u?.price && f.expected_value.trim() === "") set("expected_value", String(u.price));
  }

  async function save() {
    setErr(null);
    if (!f.stage_id) return setErr("لا مراحل مفتوحة معرَّفة — راجع إعدادات الـCRM.");
    const value = f.expected_value.trim() === "" ? null : Number(f.expected_value);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return setErr("القيمة رقم موجب.");

    setSaving(true);
    const { error } = await supabase.from("opportunities").insert({
      client_id: clientId,
      project_id: f.project_id || null,
      unit_id: f.unit_id || null,
      stage_id: f.stage_id,
      expected_value: value,
      expected_close_date: f.expected_close_date || null,
      payment_method: f.payment_method || null,
      notes: f.notes.trim() || null,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    setOpen(false);
    setF((p) => ({ ...p, unit_id: "", expected_value: "", expected_close_date: "", notes: "" }));
    router.refresh();
  }

  if (openStages.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3.5 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
      >
        <span className="material-symbols-outlined text-[18px]">add_business</span>
        فرصة جديدة
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-brand-200 bg-white p-4 shadow-sm">
      <p className="font-semibold text-gray-800">فرصة جديدة</p>
      <p className="text-xs text-gray-500">صفقة واحدة على مشروع. المالك والاحتمال يُملآن تلقائياً.</p>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-gray-500">المشروع</span>
          <select value={f.project_id} onChange={(e) => { set("project_id", e.target.value); set("unit_id", ""); }} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
            <option value="">— بلا مشروع بعد —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">الوحدة (اختياري)</span>
          <select value={f.unit_id} disabled={!f.project_id} onChange={(e) => pickUnit(e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 disabled:bg-gray-50">
            <option value="">—</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unit_code ?? "وحدة"} {u.unit_type ? `· ${u.unit_type}` : ""} {u.price ? `· ${Number(u.price).toLocaleString("en-US")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">المرحلة</span>
          <select value={f.stage_id} onChange={(e) => set("stage_id", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
            {openStages.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.probability}%</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">القيمة المتوقَّعة</span>
          <input type="number" value={f.expected_value} onChange={(e) => set("expected_value", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">تاريخ الإغلاق المتوقَّع</span>
          <input type="date" value={f.expected_close_date} onChange={(e) => set("expected_close_date", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">طريقة الدفع</span>
          <select value={f.payment_method} onChange={(e) => set("payment_method", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
            <option value="">—</option>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs text-gray-500">ملاحظات</span>
          <input value={f.notes} onChange={(e) => set("notes", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" />
        </label>
        {err && <p className="text-xs text-red-700 sm:col-span-2">{err}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? "يفتح…" : "افتح الفرصة"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
