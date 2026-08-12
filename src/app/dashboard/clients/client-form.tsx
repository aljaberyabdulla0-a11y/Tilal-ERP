"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  ALT_CONTACT_RELATIONS,
  Client,
  IRAQ_GOVERNORATES,
  PURCHASE_PURPOSES,
  CLIENT_SOURCES,
  PAYMENT_METHODS,
  isValidIraqPhone,
  toIntlPhone,
  toLocalPhone,
} from "@/lib/types";

// تاريخ اليوم بصيغة YYYY-MM-DD (للقيمة الافتراضية لحقل التاريخ)
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// نموذج مشترك لإضافة/تعديل عميل
// - بدون clientId  → وضع الإضافة (insert)
// - مع clientId    → وضع التعديل (update)
export default function ClientForm({
  initial,
  clientId,
  employeeNames = [],
}: {
  initial?: Partial<Client>;
  clientId?: string;
  // أسماء الموظفين المتاحة — الاسم هنا يحدّد من يشوف هذا العميل،
  // فلازم يطابق ملف الموظفين حرفياً (لذلك قائمة وليس كتابة حرة)
  employeeNames?: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = Boolean(clientId);

  const [form, setForm] = useState({
    name: initial?.name ?? "",
    phone: initial?.phone ?? "",
    governorate: initial?.governorate ?? "",
    area: initial?.area ?? "",
    purchase_purpose: initial?.purchase_purpose ?? "سكن",
    source: initial?.source ?? "",
    payment_method: initial?.payment_method ?? "",
    sales_employee: initial?.sales_employee ?? "",
    entry_date: initial?.entry_date ?? today(),
    notes: initial?.notes ?? "",
    // جهة اتصال بديلة — اختيارية بالكامل، تُضاف الآن أو لاحقاً
    alt_contact_name: initial?.alt_contact_name ?? "",
    alt_contact_phone: initial?.alt_contact_phone ?? "",
    alt_contact_relation: initial?.alt_contact_relation ?? "",
  });

  // القسم مفتوح تلقائياً لو للعميل جهة بديلة محفوظة أصلاً
  const [showAlt, setShowAlt] = useState(
    Boolean(initial?.alt_contact_name || initial?.alt_contact_phone)
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  // القائمة المعروضة — نضيف لها القيمة المحفوظة سابقاً إن كانت
  // لموظف قديم لم يعد في القائمة، حتى لا تضيع عند التعديل
  const options = Array.from(
    new Set([...employeeNames, form.sales_employee].filter(Boolean))
  );

  // هل الرقم الحالي بالصيغة الدولية؟
  const isIntl = form.phone.startsWith("+964");
  const isAltIntl = form.alt_contact_phone.startsWith("+964");

  function togglePhoneFormat() {
    setForm((prev) => ({
      ...prev,
      phone: isIntl ? toLocalPhone(prev.phone) : toIntlPhone(prev.phone),
    }));
  }

  function toggleAltPhoneFormat() {
    setForm((prev) => ({
      ...prev,
      alt_contact_phone: isAltIntl
        ? toLocalPhone(prev.alt_contact_phone)
        : toIntlPhone(prev.alt_contact_phone),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.phone && !isValidIraqPhone(form.phone)) {
      setError(
        "رقم الهاتف غير صحيح. يجب أن يكون 11 رقماً يبدأ بـ 07 (مثال: 07701234567) أو بالصيغة الدولية +964."
      );
      return;
    }

    // رقم البديل اختياري، لكن إن كُتب فيجب أن يكون صحيحاً — رقم خاطئ
    // محفوظ أسوأ من لا رقم: الموظف سيتصل به ويظنّ العميل لا يردّ.
    if (form.alt_contact_phone && !isValidIraqPhone(form.alt_contact_phone)) {
      setError(
        "رقم جهة الاتصال البديلة غير صحيح. اتركه فارغاً أو اكتب 11 رقماً يبدأ بـ 07."
      );
      return;
    }

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      alt_contact_name: form.alt_contact_name.trim() || null,
      alt_contact_phone: form.alt_contact_phone.trim() || null,
      alt_contact_relation: form.alt_contact_relation || null,
      governorate: form.governorate || null,
      area: form.area.trim() || null,
      purchase_purpose: form.purchase_purpose || null,
      source: form.source || null,
      payment_method: form.payment_method || null,
      sales_employee: form.sales_employee.trim() || null,
      entry_date: form.entry_date || null,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    // نفس النموذج يخدم الحالتين: تعديل أو إضافة
    const { error } = isEdit
      ? await supabase.from("clients").update(payload).eq("id", clientId!)
      : await supabase.from("clients").insert(payload);
    setSaving(false);

    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }

    // بعد التعديل نرجع لصفحة تفاصيل العميل، وبعد الإضافة للقائمة
    router.push(isEdit ? `/dashboard/clients/${clientId}` : "/dashboard/clients");
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
        الحقول المعلّمة بـ {req} إلزامية، والباقي اختياري.
      </p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* الاسم */}
        <div className="sm:col-span-2">
          <label className={labelClass}>الاسم {req}</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className={inputClass}
            placeholder="الاسم الكامل"
          />
        </div>

        {/* رقم الهاتف + زر التحويل الدولي */}
        <div className="sm:col-span-2">
          <label className={labelClass}>رقم الهاتف {req}</label>
          <div className="flex gap-2">
            <input
              type="tel"
              required
              dir="ltr"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              className={inputClass + " text-start"}
              placeholder={isIntl ? "+9647701234567" : "07701234567"}
            />
            <button
              type="button"
              onClick={togglePhoneFormat}
              className="whitespace-nowrap rounded-lg border border-brand-300 bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-700 transition hover:bg-brand-100"
              title="التبديل بين الصيغة المحلية والدولية"
            >
              {isIntl ? "→ محلي 07" : "→ دولي +964"}
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            11 رقماً يبدأ بـ 07، أو اضغط الزر للتحويل إلى الصيغة الدولية.
          </p>
        </div>

        {/* ===== جهة اتصال بديلة — اختيارية بالكامل ===== */}
        <div className="sm:col-span-2">
          {!showAlt ? (
            <button
              type="button"
              onClick={() => setShowAlt(true)}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-4 py-2.5 text-sm text-gray-600 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
            >
              <span className="material-symbols-outlined text-[18px]">person_add</span>
              + إضافة شخص ينوب عن العميل في التواصل (اختياري)
            </button>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">
                    شخص ينوب عن العميل في التواصل
                  </h3>
                  <p className="text-xs text-gray-500">
                    قريب، زوج/زوجة، مدير أعمال… <b>كله اختياري</b> — تقدر تضيفه
                    لاحقاً متى أعطاك العميل الرقم.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowAlt(false);
                    setForm((p) => ({
                      ...p,
                      alt_contact_name: "",
                      alt_contact_phone: "",
                      alt_contact_relation: "",
                    }));
                  }}
                  className="whitespace-nowrap text-xs text-gray-500 hover:text-red-600"
                >
                  إزالة
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>الاسم</label>
                  <input
                    type="text"
                    value={form.alt_contact_name}
                    onChange={(e) => update("alt_contact_name", e.target.value)}
                    className={inputClass}
                    placeholder="اسم الشخص البديل"
                  />
                </div>

                <div>
                  <label className={labelClass}>صفته</label>
                  <select
                    value={form.alt_contact_relation}
                    onChange={(e) => update("alt_contact_relation", e.target.value)}
                    className={inputClass}
                  >
                    <option value="">— اختر الصفة —</option>
                    {ALT_CONTACT_RELATIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className={labelClass}>رقم هاتفه</label>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      dir="ltr"
                      value={form.alt_contact_phone}
                      onChange={(e) => update("alt_contact_phone", e.target.value)}
                      className={inputClass + " text-start"}
                      placeholder={isAltIntl ? "+9647701234567" : "07701234567"}
                    />
                    <button
                      type="button"
                      onClick={toggleAltPhoneFormat}
                      className="whitespace-nowrap rounded-lg border border-brand-300 bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-700 transition hover:bg-brand-100"
                      title="التبديل بين الصيغة المحلية والدولية"
                    >
                      {isAltIntl ? "→ محلي 07" : "→ دولي +964"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
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

        {/* الغرض من الشراء */}
        <div>
          <label className={labelClass}>الغرض من الشراء {req}</label>
          <select
            required
            value={form.purchase_purpose}
            onChange={(e) => update("purchase_purpose", e.target.value)}
            className={inputClass}
          >
            {PURCHASE_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {/* مصدر العميل */}
        <div>
          <label className={labelClass}>مصدر العميل {req}</label>
          <select
            required
            value={form.source}
            onChange={(e) => update("source", e.target.value)}
            className={inputClass}
          >
            <option value="">— اختر المصدر —</option>
            {CLIENT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* طريقة الدفع */}
        <div>
          <label className={labelClass}>طريقة الدفع {req}</label>
          <select
            required
            value={form.payment_method}
            onChange={(e) => update("payment_method", e.target.value)}
            className={inputClass}
          >
            <option value="">— اختر طريقة الدفع —</option>
            {PAYMENT_METHODS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {/* موظف المبيعات — قائمة من ملف الموظفين */}
        <div>
          <label className={labelClass}>موظف المبيعات {req}</label>
          {options.length > 0 ? (
            <select
              required
              value={form.sales_employee}
              onChange={(e) => update("sales_employee", e.target.value)}
              className={inputClass}
            >
              <option value="">— اختر الموظف —</option>
              {options.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              required
              value={form.sales_employee}
              onChange={(e) => update("sales_employee", e.target.value)}
              className={inputClass}
              placeholder="اسم الموظف المسؤول"
            />
          )}
          <p className="mt-1 text-xs text-gray-400">
            الموظف المختار هو من يشوف هذا العميل في حسابه.
          </p>
        </div>

        {/* التاريخ */}
        <div>
          <label className={labelClass}>التاريخ {req}</label>
          <input
            type="date"
            required
            dir="ltr"
            value={form.entry_date}
            onChange={(e) => update("entry_date", e.target.value)}
            className={inputClass + " text-start"}
          />
        </div>

        {/* ملاحظات */}
        <div className="sm:col-span-2">
          <label className={labelClass}>ملاحظات {req}</label>
          <textarea
            rows={5}
            required
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            className={inputClass}
            placeholder="اكتب أي تفاصيل إضافية عن العميل هنا..."
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
          {saving
            ? "جاري الحفظ..."
            : isEdit
            ? "حفظ التعديلات"
            : "حفظ العميل"}
        </button>
        <Link
          href={isEdit ? `/dashboard/clients/${clientId}` : "/dashboard/clients"}
          className="rounded-lg border border-gray-300 px-6 py-2.5 font-medium text-gray-700 transition hover:bg-gray-100"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
