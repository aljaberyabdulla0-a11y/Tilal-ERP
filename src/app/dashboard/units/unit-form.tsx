"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Project,
  Unit,
  UNIT_TYPES,
  UNIT_STATUSES,
  IRAQ_GOVERNORATES,
} from "@/lib/types";

// ============================================================
// نموذج مشترك لإضافة/تعديل وحدة عقارية.
// بدون unitId → إضافة | مع unitId → تعديل.
//
// المشروع صار اختياراً من جدول المشاريع لا نصّاً حرّاً: عليه يُبنى
// من يرى الوحدة (المشروع له مشرف وفريق). العمود النصّي القديم
// units.project يملؤه محفّز في القاعدة تلقائياً من اسم المشروع.
// ============================================================
export default function UnitForm({
  initial,
  unitId,
  projects,
}: {
  initial?: Partial<Unit>;
  unitId?: string;
  projects: Project[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = Boolean(unitId);

  const [form, setForm] = useState({
    project_id: initial?.project_id ?? "",
    unit_code: initial?.unit_code ?? "",
    unit_type: initial?.unit_type ?? "شقة",
    governorate: initial?.governorate ?? "",
    area: initial?.area ?? "",
    space_m2: initial?.space_m2?.toString() ?? "",
    rooms: initial?.rooms?.toString() ?? "",
    price: initial?.price?.toString() ?? "",
    status: initial?.status ?? "متاحة",
    notes: initial?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.project_id) {
      setError("اختر المشروع الذي تتبعه الوحدة.");
      return;
    }

    const payload = {
      // العمود النصّي project يملؤه محفّز القاعدة من اسم المشروع
      project_id: form.project_id,
      unit_code: form.unit_code.trim() || null,
      unit_type: form.unit_type,
      governorate: form.governorate || null,
      area: form.area.trim() || null,
      space_m2: form.space_m2 ? Number(form.space_m2) : null,
      rooms: form.rooms ? Number(form.rooms) : null,
      price: form.price ? Number(form.price) : null,
      status: form.status,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    const { error } = isEdit
      ? await supabase.from("units").update(payload).eq("id", unitId!)
      : await supabase.from("units").insert(payload);
    setSaving(false);

    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }

    router.push(isEdit ? `/dashboard/units/${unitId}` : "/dashboard/units");
    router.refresh();
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const labelClass = "mb-1 block text-sm font-medium text-gray-700";
  const req = <span className="text-red-500">*</span>;

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-3xl space-y-5 rounded-2xl bg-white p-8 shadow-sm"
    >
      <p className="text-sm text-gray-500">
        الحقول المعلّمة بـ {req} إلزامية.
      </p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* المشروع */}
        <div>
          <label className={labelClass}>المشروع {req}</label>
          <select
            required
            value={form.project_id}
            onChange={(e) => update("project_id", e.target.value)}
            className={inputClass}
          >
            <option value="">— اختر المشروع —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {projects.length === 0 && (
            <p className="mt-1 text-xs text-amber-700">
              لا توجد مشاريع بعد.{" "}
              <Link href="/dashboard/projects" className="underline">
                أنشئ مشروعاً أولاً
              </Link>
              .
            </p>
          )}
        </div>

        {/* كود الوحدة */}
        <div>
          <label className={labelClass}>رقم / كود الوحدة</label>
          <input
            type="text"
            value={form.unit_code}
            onChange={(e) => update("unit_code", e.target.value)}
            className={inputClass}
            placeholder="مثال: A-12"
          />
        </div>

        {/* نوع الوحدة */}
        <div>
          <label className={labelClass}>نوع الوحدة {req}</label>
          <select
            required
            value={form.unit_type}
            onChange={(e) => update("unit_type", e.target.value)}
            className={inputClass}
          >
            {UNIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* الحالة */}
        <div>
          <label className={labelClass}>الحالة {req}</label>
          <select
            required
            value={form.status}
            onChange={(e) => update("status", e.target.value)}
            className={inputClass}
          >
            {UNIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* المحافظة */}
        <div>
          <label className={labelClass}>المحافظة {req}</label>
          <select
            required
            value={form.governorate}
            onChange={(e) => update("governorate", e.target.value)}
            className={inputClass}
          >
            <option value="">— اختر المحافظة —</option>
            {IRAQ_GOVERNORATES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        {/* المنطقة */}
        <div>
          <label className={labelClass}>المنطقة {req}</label>
          <input
            type="text"
            required
            value={form.area}
            onChange={(e) => update("area", e.target.value)}
            className={inputClass}
            placeholder="اسم المنطقة أو الحي"
          />
        </div>

        {/* المساحة */}
        <div>
          <label className={labelClass}>المساحة (م²)</label>
          <input
            type="number"
            min="0"
            step="any"
            dir="ltr"
            value={form.space_m2}
            onChange={(e) => update("space_m2", e.target.value)}
            className={inputClass + " text-start"}
            placeholder="مثال: 150"
          />
        </div>

        {/* عدد الغرف */}
        <div>
          <label className={labelClass}>عدد الغرف</label>
          <input
            type="number"
            min="0"
            step="1"
            dir="ltr"
            value={form.rooms}
            onChange={(e) => update("rooms", e.target.value)}
            className={inputClass + " text-start"}
            placeholder="مثال: 3"
          />
        </div>

        {/* السعر */}
        <div className="sm:col-span-2">
          <label className={labelClass}>السعر (دينار عراقي) {req}</label>
          <input
            type="number"
            required
            min="0"
            step="any"
            dir="ltr"
            value={form.price}
            onChange={(e) => update("price", e.target.value)}
            className={inputClass + " text-start"}
            placeholder="مثال: 150000000"
          />
        </div>

        {/* ملاحظات */}
        <div className="sm:col-span-2">
          <label className={labelClass}>ملاحظات</label>
          <textarea
            rows={4}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            className={inputClass}
            placeholder="أي تفاصيل إضافية عن الوحدة..."
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جاري الحفظ..." : isEdit ? "حفظ التعديلات" : "حفظ الوحدة"}
        </button>
        <Link
          href={isEdit ? `/dashboard/units/${unitId}` : "/dashboard/units"}
          className="rounded-lg border border-gray-300 px-6 py-2.5 font-medium text-gray-700 transition hover:bg-gray-100"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
