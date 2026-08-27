"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  IRAQ_GOVERNORATES,
  PAYMENT_METHODS,
  PURCHASE_PURPOSES,
  Project,
  isValidPhone,
} from "@/lib/types";
import PhoneInput from "@/components/phone-input";

// ============================================================
// إدخال ليد جديد — شاشة الشركة الوسيطة.
//
// الحقول هنا أقلّ من نموذج تلال الداخلي عمداً: الشركة تُعطينا العميل
// ومشروعه وما تعرفه عنه، وبقية الحقول (موظف المبيعات، المرحلة،
// المتابعات الداخلية) شأن تلال.
//
// شركة الليد ومهلته لا يُرسلان من هنا — القاعدة تختمهما من هوية
// المُدخِل (sql/043)، فلا تستطيع شركة إدخال ليد باسم أخرى ولا منح
// نفسها مهلة أطول.
// ============================================================
export default function BrokerLeadForm({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState({
    name: "",
    phone: "",
    project_id: projects.length === 1 ? projects[0].id : "",
    governorate: "",
    area: "",
    purchase_purpose: "",
    payment_method: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError("اكتب اسم العميل.");
      return;
    }
    if (!form.project_id) {
      setError("اختر المشروع.");
      return;
    }
    if (form.phone && !isValidPhone(form.phone)) {
      setError("رقم الهاتف غير مكتمل.");
      return;
    }

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("clients").insert({
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      project_id: form.project_id,
      governorate: form.governorate || null,
      area: form.area.trim() || null,
      purchase_purpose: form.purchase_purpose || null,
      payment_method: form.payment_method || null,
      notes: form.notes.trim() || null,
      created_by: user?.id ?? null,
    });
    setSaving(false);

    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }

    router.push("/dashboard/broker/leads");
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
      <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
        بمجرد الحفظ تبدأ مهلة <b>٣٠ يوماً</b> على هذا الليد. إن لم يُغلق البيع
        خلالها يعود الليد إلى تلال.
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={labelClass}>اسم العميل {req}</label>
          <input
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>الهاتف</label>
          <PhoneInput
            value={form.phone}
            onChange={(v) => update("phone", v)}
          />
        </div>

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
        </div>

        <div>
          <label className={labelClass}>المحافظة</label>
          <select
            value={form.governorate}
            onChange={(e) => update("governorate", e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {IRAQ_GOVERNORATES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>المنطقة</label>
          <input
            value={form.area}
            onChange={(e) => update("area", e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>الغرض من الشراء</label>
          <select
            value={form.purchase_purpose}
            onChange={(e) => update("purchase_purpose", e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {PURCHASE_PURPOSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>طريقة الدفع</label>
          <select
            value={form.payment_method}
            onChange={(e) => update("payment_method", e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
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

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ..." : "إضافة الليد"}
        </button>
        <Link
          href="/dashboard/broker/leads"
          className="rounded-lg border border-gray-300 px-6 py-2.5 text-gray-600 transition hover:bg-gray-100"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
