"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  JSON_UNIT_FIELDS,
  NodeTree,
  UNIT_FIELD_LABELS,
  UNIT_STATUS_LIST,
  Unit,
  UnitField,
  UnitTypeRow,
  unitFieldsFor,
} from "@/lib/types";

// ============================================================
// نموذج الوحدة — حقوله تتبدّل بنوعها.
//
// النوع يحمل فئة (عمودي/أفقي/تجاري/أرض) تأتي من جدول unit_types،
// والفئة تقرّر الحقول. فإضافة نوع جديد غداً لا تحتاج سطراً هنا:
// يكفي صفّ في القاعدة بفئته الصحيحة.
//
// الحقول التي يُصفّى بها أعمدة حقيقية، وما عداها داخل attrs —
// لذلك تُقسَّم القيم عند الحفظ إلى مجموعتين.
// ============================================================

const NUMERIC: UnitField[] = [
  "space_m2", "land_area_m2", "built_area_m2",
  "rooms", "bathrooms", "floors_count", "parking_spaces",
];

export default function UnitEditor({
  projectId,
  unit,
  nodes,
  unitTypes,
  isAdmin,
}: {
  projectId: string;
  unit: Unit | null;         // فارغ = وحدة جديدة
  nodes: NodeTree[];
  unitTypes: UnitTypeRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [nodeId, setNodeId] = useState(unit?.node_id ?? "");
  const [unitCode, setUnitCode] = useState(unit?.unit_code ?? "");
  const [unitType, setUnitType] = useState(unit?.unit_type ?? unitTypes[0]?.name ?? "شقة");
  const [status, setStatus] = useState(unit?.status ?? "متاحة");
  const [blockedReason, setBlockedReason] = useState(unit?.blocked_reason ?? "");
  const [price, setPrice] = useState(unit?.price?.toString() ?? "");
  const [paymentPlan, setPaymentPlan] = useState(unit?.payment_plan ?? "");
  const [notes, setNotes] = useState(unit?.notes ?? "");

  // قيم الحقول المتغيّرة، أعمدةً كانت أو داخل attrs
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    if (unit) {
      v.space_m2 = unit.space_m2?.toString() ?? "";
      v.land_area_m2 = unit.land_area_m2?.toString() ?? "";
      v.built_area_m2 = unit.built_area_m2?.toString() ?? "";
      v.rooms = unit.rooms?.toString() ?? "";
      v.bathrooms = unit.bathrooms?.toString() ?? "";
      v.floors_count = unit.floors_count?.toString() ?? "";
      v.parking_spaces = unit.parking_spaces?.toString() ?? "";
      for (const k of JSON_UNIT_FIELDS) {
        const raw = unit.attrs?.[k];
        v[k] = raw === null || raw === undefined ? "" : String(raw);
      }
    }
    return v;
  });

  const category = useMemo(
    () => unitTypes.find((t) => t.name === unitType)?.category ?? "أخرى",
    [unitTypes, unitType],
  );
  const fields = useMemo(() => unitFieldsFor(category), [category]);

  const flat: { id: string; label: string }[] = [];
  (function walk(list: NodeTree[]) {
    for (const n of list) {
      flat.push({ id: n.id, label: "— ".repeat(n.depth) + n.name });
      walk(n.children);
    }
  })(nodes);

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const label = "mb-1 block text-xs font-medium text-gray-600";

  function num(v: string): number | null {
    if (!v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function save() {
    setErr(null);
    if (!unitCode.trim()) {
      setErr("رقم الوحدة مطلوب — به تُعرف الوحدة في كل الشاشات.");
      return;
    }
    if (status === "موقوفة" && !blockedReason.trim()) {
      setErr("اكتب سبب الإيقاف — وحدة موقوفة بلا سبب تُنسى موقوفة.");
      return;
    }

    // ما يظهر لهذا النوع فقط يُحفظ، فلا تبقى غرفٌ على قطعة أرض
    const attrs: Record<string, string> = {};
    for (const f of fields) {
      if (JSON_UNIT_FIELDS.includes(f) && values[f]?.trim()) {
        attrs[f] = values[f].trim();
      }
    }
    const col = (f: UnitField) =>
      fields.includes(f) ? num(values[f] ?? "") : null;

    const row: Record<string, unknown> = {
      node_id: nodeId || null,
      project_id: projectId,
      unit_code: unitCode.trim(),
      unit_type: unitType,
      status,
      blocked_reason: status === "موقوفة" ? blockedReason.trim() : null,
      payment_plan: paymentPlan.trim() || null,
      notes: notes.trim() || null,
      space_m2: col("space_m2"),
      land_area_m2: col("land_area_m2"),
      built_area_m2: col("built_area_m2"),
      rooms: col("rooms"),
      bathrooms: col("bathrooms"),
      floors_count: col("floors_count"),
      parking_spaces: col("parking_spaces"),
      attrs,
    };

    // السعر للمدير وحده — والقاعدة ترفضه من غيره بمحفّز، فحذفه
    // هنا يمنع الاصطدام لا الالتفاف (sql/044).
    if (isAdmin) row.price = num(price);

    setSaving(true);
    const { error, data } = unit
      ? await supabase.from("units").update(row).eq("id", unit.id).select("id").maybeSingle()
      : await supabase.from("units").insert(row).select("id").maybeSingle();
    setSaving(false);

    if (error) {
      setErr("تعذّر الحفظ: " + error.message);
      return;
    }
    router.push(`/dashboard/units/${unit?.id ?? data?.id}`);
    router.refresh();
  }

  return (
    <div className="max-w-3xl space-y-5">
      {/* الموقع والهوية */}
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-bold text-gray-700">الموقع والهوية</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>الموقع في الهيكل</label>
            <select
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
              className={input}
            >
              <option value="">خارج الهيكل</option>
              {flat.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>رقم / كود الوحدة *</label>
            <input
              value={unitCode}
              onChange={(e) => setUnitCode(e.target.value)}
              placeholder="101"
              className={input}
            />
          </div>
          <div>
            <label className={label}>نوع الوحدة</label>
            <select
              value={unitType}
              onChange={(e) => setUnitType(e.target.value)}
              className={input}
            >
              {unitTypes.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>الحالة</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={input}
              disabled={!isAdmin && (status === "محجوزة" || status === "مباعة")}
            >
              {UNIT_STATUS_LIST.map((s) => (
                <option key={s} value={s} disabled={s === "موقوفة" && !isAdmin}>
                  {s}
                </option>
              ))}
            </select>
            {(status === "محجوزة" || status === "مباعة") && (
              <p className="mt-1 text-[11px] text-gray-500">
                هذه الحالة تتبع الحجوزات آلياً — غيّرها من الحجز لا من هنا.
              </p>
            )}
          </div>
          {status === "موقوفة" && (
            <div className="sm:col-span-2">
              <label className={label}>سبب الإيقاف *</label>
              <input
                value={blockedReason}
                onChange={(e) => setBlockedReason(e.target.value)}
                placeholder="محجوزة للإدارة / نزاع ملكية / تحت الصيانة"
                className={input}
              />
            </div>
          )}
        </div>
      </section>

      {/* المواصفات — تتبدّل بالنوع */}
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-700">المواصفات</h2>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
            {category}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {fields.map((f) => (
            <div key={f}>
              <label className={label}>{UNIT_FIELD_LABELS[f]}</label>
              <input
                value={values[f] ?? ""}
                onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                type={NUMERIC.includes(f) ? "number" : "text"}
                min={NUMERIC.includes(f) ? 0 : undefined}
                dir={NUMERIC.includes(f) ? "ltr" : undefined}
                className={input}
              />
            </div>
          ))}
        </div>
      </section>

      {/* المال */}
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-bold text-gray-700">السعر والدفع</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>السعر (دينار عراقي)</label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              min={0}
              dir="ltr"
              disabled={!isAdmin}
              className={input + (isAdmin ? "" : " bg-gray-100 text-gray-500")}
            />
            {!isAdmin && (
              <p className="mt-1 text-[11px] text-gray-500">
                تعديل السعر للمدير وحده.
              </p>
            )}
          </div>
          <div>
            <label className={label}>خطة الدفع</label>
            <input
              value={paymentPlan}
              onChange={(e) => setPaymentPlan(e.target.value)}
              placeholder="٣٠٪ مقدّم و٧٠٪ على ٢٤ قسطاً"
              className={input}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className={label}>ملاحظات</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={input}
          />
        </div>
      </section>

      {err && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ…" : unit ? "حفظ التعديلات" : "إضافة الوحدة"}
        </button>
        <button
          onClick={() => router.back()}
          className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
