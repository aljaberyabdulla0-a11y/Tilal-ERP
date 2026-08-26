"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  InventoryItem,
  MOVE_KINDS,
  Supplier,
  formatQty,
} from "@/lib/types";

// ============================================================
// تسجيل حركة مخزون: شراء أو صرف أو تسوية.
//
// هذه هي الشاشة الوحيدة التي يتغيّر منها الرصيد في النظام كله.
// «ماء ← شراء 100 ← صرف 20 ← المتبقي 80» تُكتب هنا سطراً سطراً،
// والمتبقي يحسبه محفّز في القاعدة (sql/040).
//
// تُستعمل في مكانين: صفحة «تسجيل حركة»، وداخل صفحة المادة بشكل
// مختصر (المادة محدّدة سلفاً فلا نعرض قائمتها).
// ============================================================
export default function MoveForm({
  items,
  fixedItem,
  defaultKind,
  suppliers,
  redirectTo,
}: {
  items: InventoryItem[];
  fixedItem?: InventoryItem;
  defaultKind?: string;
  suppliers: Supplier[];
  redirectTo?: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  // تاريخ اليوم بتوقيت بغداد — القاعدة تستعمل نفس التوقيت افتراضياً
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Baghdad",
  });

  const [form, setForm] = useState({
    item_id: fixedItem?.id ?? "",
    kind: defaultKind && (MOVE_KINDS as readonly string[]).includes(defaultKind)
      ? defaultKind
      : "شراء",
    quantity: "",
    unit_price: "",
    supplier_id: fixedItem?.supplier_id ?? "",
    moved_at: today,
    issued_to: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const item = fixedItem ?? items.find((i) => i.id === form.item_id) ?? null;
  const isPurchase = form.kind === "شراء";
  const isIssue = form.kind === "صرف";

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // تغيير المادة يجلب مورّدها المعتاد — أكثر ما يُختار عملياً
      if (field === "item_id" && !fixedItem) {
        const picked = items.find((i) => i.id === value);
        next.supplier_id = picked?.supplier_id ?? "";
      }
      return next;
    });
  }

  // الرصيد بعد هذه الحركة — يراه المستخدم قبل الحفظ لا بعده
  const qty = Number(form.quantity);
  const preview =
    item && Number.isFinite(qty) && qty !== 0
      ? item.quantity + (isIssue ? -Math.abs(qty) : qty)
      : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.item_id) {
      setError("اختر المادة.");
      return;
    }
    if (!qty) {
      setError("اكتب الكمية.");
      return;
    }
    if (form.kind !== "تسوية" && qty <= 0) {
      setError("الكمية في الشراء والصرف تكون أكبر من صفر.");
      return;
    }
    if (isIssue && item && qty > item.quantity) {
      setError(
        `الرصيد الحالي ${formatQty(item.quantity)} ${item.unit} فقط — لا يمكن صرف ${formatQty(qty)}. صحّح الرصيد بحركة «تسوية» إن كان الجرد مختلفاً.`
      );
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("inventory_moves").insert({
      item_id: form.item_id,
      kind: form.kind,
      quantity: qty,
      unit_price: isPurchase && form.unit_price ? Number(form.unit_price) : null,
      supplier_id: isPurchase && form.supplier_id ? form.supplier_id : null,
      moved_at: form.moved_at,
      issued_to: isIssue ? form.issued_to.trim() || null : null,
      notes: form.notes.trim() || null,
    });
    setSaving(false);

    if (error) {
      setError("تعذّر التسجيل: " + error.message);
      return;
    }

    router.push(redirectTo ?? `/dashboard/inventory/${form.item_id}`);
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
      {/* نوع الحركة — أزرار لا قائمة، لأنه أهم اختيار في الشاشة */}
      <div>
        <label className={labelClass}>نوع الحركة {req}</label>
        <div className="flex flex-wrap gap-2">
          {MOVE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => update("kind", k)}
              className={
                form.kind === k
                  ? "rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white"
                  : "rounded-lg border border-gray-300 px-5 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
              }
            >
              {k}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-400">
          {isPurchase
            ? "الشراء يزيد الرصيد ويسجّل السعر والمورد."
            : isIssue
            ? "الصرف ينقص الرصيد — استعمله لكل ما يُستهلك أو يُسلَّم."
            : "التسوية لتصحيح الجرد: موجبة تزيد وسالبة تنقص."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* المادة */}
        <div>
          <label className={labelClass}>المادة {req}</label>
          {fixedItem ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-gray-700">
              {fixedItem.name}
            </div>
          ) : (
            <select
              required
              value={form.item_id}
              onChange={(e) => update("item_id", e.target.value)}
              className={inputClass}
            >
              <option value="">— اختر المادة —</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({formatQty(i.quantity)} {i.unit})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* الكمية */}
        <div>
          <label className={labelClass}>
            الكمية {req}
            {item && <span className="text-gray-400"> — بالـ{item.unit}</span>}
          </label>
          <input
            required
            type="number"
            step="0.01"
            value={form.quantity}
            onChange={(e) => update("quantity", e.target.value)}
            className={inputClass}
            dir="ltr"
          />
          {preview !== null && item && (
            <p className="mt-1 text-xs font-semibold text-gray-500">
              الرصيد بعد الحركة: {formatQty(preview)} {item.unit}
              <span className="text-gray-400">
                {" "}
                (الحالي {formatQty(item.quantity)})
              </span>
            </p>
          )}
        </div>

        {/* التاريخ */}
        <div>
          <label className={labelClass}>التاريخ {req}</label>
          <input
            required
            type="date"
            value={form.moved_at}
            onChange={(e) => update("moved_at", e.target.value)}
            className={inputClass}
            dir="ltr"
          />
        </div>

        {isPurchase && (
          <>
            <div>
              <label className={labelClass}>سعر شراء الوحدة</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.unit_price}
                onChange={(e) => update("unit_price", e.target.value)}
                className={inputClass}
                dir="ltr"
              />
              {form.unit_price && qty > 0 && (
                <p className="mt-1 text-xs text-gray-500" dir="ltr">
                  {(Number(form.unit_price) * qty).toLocaleString("en-US")}
                </p>
              )}
            </div>

            <div>
              <label className={labelClass}>المورد</label>
              <select
                value={form.supplier_id}
                onChange={(e) => update("supplier_id", e.target.value)}
                className={inputClass}
              >
                <option value="">— بلا مورد —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {isIssue && (
          <div>
            <label className={labelClass}>صُرف إلى</label>
            <input
              type="text"
              value={form.issued_to}
              onChange={(e) => update("issued_to", e.target.value)}
              placeholder="قسم أو موظف أو مناسبة"
              className={inputClass}
            />
          </div>
        )}
      </div>

      <div>
        <label className={labelClass}>ملاحظات</label>
        <textarea
          rows={2}
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          className={inputClass}
        />
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جارٍ التسجيل..." : "تسجيل الحركة"}
        </button>
        <Link
          href={redirectTo ?? "/dashboard/inventory"}
          className="rounded-lg border border-gray-300 px-6 py-2.5 text-gray-600 transition hover:bg-gray-100"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
