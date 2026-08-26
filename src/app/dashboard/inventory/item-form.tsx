"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  INVENTORY_CATEGORIES,
  INVENTORY_UNITS,
  InventoryItem,
  Supplier,
} from "@/lib/types";

// ============================================================
// نموذج مشترك لإضافة/تعديل مادة.
// بدون itemId → إضافة | مع itemId → تعديل.
//
// ⚠️ لا يوجد حقل «الكمية الحالية» في التعديل عمداً: الرصيد ناتج
// الحركات لا رقم يُكتب. وفي الإضافة يوجد «الرصيد الافتتاحي» فقط،
// ويُسجَّل هو نفسه كحركة تسوية حتى يبقى لكل رقم في المخزون سبب
// مكتوب في السجلّ.
// ============================================================
export default function ItemForm({
  initial,
  itemId,
  suppliers,
}: {
  initial?: Partial<InventoryItem>;
  itemId?: string;
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = Boolean(itemId);

  const [form, setForm] = useState({
    name: initial?.name ?? "",
    category: initial?.category ?? "مستلزمات أخرى",
    unit: initial?.unit ?? "قطعة",
    min_quantity: initial?.min_quantity?.toString() ?? "0",
    supplier_id: initial?.supplier_id ?? "",
    notes: initial?.notes ?? "",
    is_active: initial?.is_active ?? true,
    opening: "", // الرصيد الافتتاحي (عند الإضافة فقط)
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(field: keyof typeof form, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError("اكتب اسم المادة.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      category: form.category,
      unit: form.unit.trim() || "قطعة",
      min_quantity: Number(form.min_quantity) || 0,
      supplier_id: form.supplier_id || null,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    };

    setSaving(true);

    if (isEdit) {
      const { error } = await supabase
        .from("inventory_items")
        .update(payload)
        .eq("id", itemId!);
      setSaving(false);
      if (error) {
        setError("تعذّر الحفظ: " + error.message);
        return;
      }
      router.push(`/dashboard/inventory/${itemId}`);
      router.refresh();
      return;
    }

    const { data, error } = await supabase
      .from("inventory_items")
      .insert(payload)
      .select("id")
      .single();

    if (error || !data) {
      setSaving(false);
      setError(
        error?.message.includes("inventory_items_name_uidx")
          ? "توجد مادة بهذا الاسم فعلاً — افتحها وسجّل عليها الحركة بدل إنشاء مادة ثانية."
          : "تعذّر الحفظ: " + (error?.message ?? "خطأ غير معروف")
      );
      return;
    }

    // الرصيد الافتتاحي — حركة تسوية باسم صريح، لا رقم يُدسّ في الجدول
    const opening = Number(form.opening);
    if (opening) {
      const { error: moveError } = await supabase.from("inventory_moves").insert({
        item_id: data.id,
        kind: "تسوية",
        quantity: opening,
        notes: "رصيد افتتاحي",
      });
      if (moveError) {
        setSaving(false);
        setError(
          "أُضيفت المادة، لكن تعذّر تسجيل الرصيد الافتتاحي: " + moveError.message
        );
        return;
      }
    }

    setSaving(false);
    router.push(`/dashboard/inventory/${data.id}`);
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
      <p className="text-sm text-gray-500">الحقول المعلّمة بـ {req} إلزامية.</p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={labelClass}>اسم المادة {req}</label>
          <input
            required
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="مثال: ماء شرب — كارتون 12 عبوة"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>التصنيف {req}</label>
          <select
            required
            value={form.category}
            onChange={(e) => update("category", e.target.value)}
            className={inputClass}
          >
            {INVENTORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>وحدة القياس {req}</label>
          <input
            required
            list="inventory-units"
            value={form.unit}
            onChange={(e) => update("unit", e.target.value)}
            className={inputClass}
          />
          <datalist id="inventory-units">
            {INVENTORY_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <p className="mt-1 text-xs text-gray-400">
            بها يُحسب كل شيء: كارتون، علبة، قطعة…
          </p>
        </div>

        <div>
          <label className={labelClass}>الحد الأدنى للمخزون</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.min_quantity}
            onChange={(e) => update("min_quantity", e.target.value)}
            className={inputClass}
            dir="ltr"
          />
          <p className="mt-1 text-xs text-gray-400">
            حين ينزل الرصيد تحته يصلك تنبيه في الجرس. صفر = بلا تنبيه.
          </p>
        </div>

        <div>
          <label className={labelClass}>المورد المعتاد</label>
          <select
            value={form.supplier_id}
            onChange={(e) => update("supplier_id", e.target.value)}
            className={inputClass}
          >
            <option value="">— بلا مورد محدّد —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {!isEdit && (
          <div>
            <label className={labelClass}>الرصيد الافتتاحي</label>
            <input
              type="number"
              step="0.01"
              value={form.opening}
              onChange={(e) => update("opening", e.target.value)}
              placeholder="0"
              className={inputClass}
              dir="ltr"
            />
            <p className="mt-1 text-xs text-gray-400">
              الموجود فعلاً الآن قبل تسجيل أي شراء. يُسجَّل كحركة «تسوية».
            </p>
          </div>
        )}
      </div>

      <div>
        <label className={labelClass}>ملاحظات</label>
        <textarea
          rows={3}
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          className={inputClass}
        />
      </div>

      {isEdit && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => update("is_active", e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          مادة فعّالة (أزل العلامة لإخفائها من التنبيهات والمؤشرات مع بقاء سجلّها)
        </label>
      )}

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ..." : isEdit ? "حفظ التعديلات" : "إضافة المادة"}
        </button>
        <Link
          href={isEdit ? `/dashboard/inventory/${itemId}` : "/dashboard/inventory"}
          className="rounded-lg border border-gray-300 px-6 py-2.5 text-gray-600 transition hover:bg-gray-100"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
