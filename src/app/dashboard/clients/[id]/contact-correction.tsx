"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isValidPhone } from "@/lib/types";
import { baghdadDate } from "@/lib/time";
import PhoneInput from "@/components/phone-input";

// ============================================================
// تصحيح موظف المبيعات لاسم عميله ورقمه — مرة واحدة (220).
//
// نموذج «تعديل» البطاقة للمدير ومدير التسويق والمشرف. والموظف الذي
// أخطأ في حرفٍ من الاسم أو رقمٍ من الهاتف يصحّحهما هنا مرة واحدة.
// الحدّ في القاعدة (guard_client_contact_correction): المرة الثانية
// تُرفض برسالتها، والقيمتان قبل التصحيح تُحفظان في contact_before.
// ============================================================
export default function ContactCorrection({
  clientId,
  name,
  phone,
  correctedAt,
}: {
  clientId: string;
  name: string;
  phone: string | null;
  correctedAt: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name, phone: phone ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (correctedAt) {
    return (
      <span
        className="text-xs text-gray-400"
        title="تصحيح الاسم والرقم مرة واحدة — والتعديل بعدها من المشرف"
      >
        صُحّح الاسم/الرقم في <span dir="ltr">{baghdadDate(correctedAt)}</span>
      </span>
    );
  }

  const changed = form.name.trim() !== name || form.phone.trim() !== (phone ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("اكتب اسم العميل.");
    if (!isValidPhone(form.phone)) {
      return setError(
        "رقم الهاتف غير مكتمل. تأكّد من مفتاح الدولة وعدد الأرقام — الافتراضي عراقي: 11 رقماً يبدأ بـ 07."
      );
    }
    if (!confirm("التصحيح مرة واحدة فقط — بعده لا يعدّل الاسم والرقم إلا المشرف. متأكد؟")) return;

    setSaving(true);
    // RLS تمنع صمتاً: صفر صفوف بلا خطأ
    const { data: saved, error: err } = await supabase
      .from("clients")
      .update({ name: form.name.trim(), phone: form.phone.trim() })
      .eq("id", clientId)
      .select("id");
    setSaving(false);
    if (err) return setError("تعذّر الحفظ: " + err.message);
    if (!saved || saved.length === 0) return setError("تعذّر الحفظ: هذا العميل خارج نطاق صلاحيتك في التعديل.");
    setOpen(false);
    router.refresh();
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setForm({ name, phone: phone ?? "" });
          setError(null);
          setOpen(true);
        }}
        className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition hover:border-brand-500 hover:text-brand-700"
      >
        <span className="material-symbols-outlined text-[18px]">edit</span>
        تصحيح الاسم والرقم
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !saving && setOpen(false)} />
          <form
            onSubmit={save}
            className="relative w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <div>
              <h3 className="text-lg font-bold text-brand-700">تصحيح الاسم والرقم</h3>
              <p className="mt-1 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900">
                تقدر تصحّح الاسم والرقم <b>مرة واحدة فقط</b> — صحّحهما معاً الآن. بعدها يعدّلهما مشرفك.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">الاسم</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className={inputClass}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">رقم الهاتف</label>
              <PhoneInput required value={form.phone} onChange={(v) => setForm((p) => ({ ...p, phone: v }))} />
            </div>

            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving || !changed}
                className="rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? "جاري الحفظ..." : "حفظ التصحيح"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setOpen(false)}
                className="rounded-lg border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-100"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
