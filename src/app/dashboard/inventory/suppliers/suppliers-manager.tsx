"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Supplier } from "@/lib/types";

type FormState = {
  name: string;
  phone: string;
  contact_person: string;
  address: string;
  notes: string;
  is_active: boolean;
};

const EMPTY: FormState = {
  name: "",
  phone: "",
  contact_person: "",
  address: "",
  notes: "",
  is_active: true,
};

// ============================================================
// الموردون — إضافة وتعديل وحذف في مكان واحد بلا تنقّل بين صفحات.
// القائمة قصيرة بطبعها (مورّدو مركز مبيعات)، فالنموذج المضمّن
// أسرع من صفحة مستقلة لكل مورد.
// ============================================================
export default function SuppliersManager({
  suppliers,
  usage,
}: {
  suppliers: Supplier[];
  usage: Record<string, number>; // كم مادة/حركة مرتبطة بكل مورد
}) {
  const router = useRouter();
  const supabase = createClient();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startCreate() {
    setForm(EMPTY);
    setEditingId(null);
    setCreating(true);
    setError(null);
  }

  function startEdit(s: Supplier) {
    setForm({
      name: s.name,
      phone: s.phone ?? "",
      contact_person: s.contact_person ?? "",
      address: s.address ?? "",
      notes: s.notes ?? "",
      is_active: s.is_active,
    });
    setEditingId(s.id);
    setCreating(false);
    setError(null);
  }

  function cancel() {
    setCreating(false);
    setEditingId(null);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("اكتب اسم المورد.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      contact_person: form.contact_person.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    };

    setSaving(true);
    setError(null);
    const { error } = editingId
      ? await supabase.from("suppliers").update(payload).eq("id", editingId)
      : await supabase.from("suppliers").insert(payload);
    setSaving(false);

    if (error) {
      setError(
        error.message.includes("suppliers_name_key")
          ? "يوجد مورد بهذا الاسم فعلاً."
          : "تعذّر الحفظ: " + error.message
      );
      return;
    }

    cancel();
    router.refresh();
  }

  async function remove(s: Supplier) {
    const linked = usage[s.id] ?? 0;
    if (
      !confirm(
        linked > 0
          ? `حذف «${s.name}»؟ سيبقى ${linked} سجلّاً مرتبطاً به بلا مورد (لن تُحذف مشترياتك).`
          : `حذف «${s.name}»؟`
      )
    )
      return;

    setError(null);
    const { error } = await supabase.from("suppliers").delete().eq("id", s.id);
    if (error) {
      setError("تعذّر الحذف: " + error.message);
      return;
    }
    router.refresh();
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const labelClass = "mb-1 block text-sm font-medium text-gray-700";

  const formCard = (
    <form onSubmit={save} className="glass-card space-y-4 p-6">
      <h3 className="text-lg font-bold text-gray-800">
        {editingId ? "تعديل مورد" : "مورد جديد"}
      </h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            اسم المورد <span className="text-red-500">*</span>
          </label>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>الهاتف</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className={inputClass}
            dir="ltr"
          />
        </div>
        <div>
          <label className={labelClass}>الشخص المسؤول</label>
          <input
            value={form.contact_person}
            onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>العنوان</label>
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>ملاحظات</label>
        <textarea
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className={inputClass}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300"
        />
        مورد فعّال
      </label>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ..." : "حفظ"}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded-lg border border-gray-300 px-6 py-2.5 text-gray-600 transition hover:bg-gray-100"
        >
          إلغاء
        </button>
      </div>
    </form>
  );

  return (
    <div className="space-y-5">
      {error && !creating && !editingId && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {creating || editingId ? (
        formCard
      ) : (
        <button
          onClick={startCreate}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + مورد جديد
        </button>
      )}

      {suppliers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
          لا يوجد موردون بعد. أضف مورداً لتربط به مشترياتك وتعرف من أين تشتري كل
          مادة.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <table className="w-full min-w-[750px] text-start text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-start font-medium">المورد</th>
                <th className="px-4 py-3 text-start font-medium">الهاتف</th>
                <th className="px-4 py-3 text-start font-medium">الشخص المسؤول</th>
                <th className="px-4 py-3 text-start font-medium">مشتريات مسجّلة</th>
                <th className="px-4 py-3 text-start font-medium">الحالة</th>
                <th className="px-4 py-3 text-start font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-800">
                    {s.name}
                    {s.notes && (
                      <span className="block text-xs font-normal text-gray-400">
                        {s.notes}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600" dir="ltr">
                    {s.phone ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.contact_person ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{usage[s.id] ?? 0}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        s.is_active
                          ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                          : "rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500"
                      }
                    >
                      {s.is_active ? "فعّال" : "موقوف"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button
                        onClick={() => startEdit(s)}
                        className="text-xs font-medium text-brand-700 hover:underline"
                      >
                        تعديل
                      </button>
                      <button
                        onClick={() => remove(s)}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
