"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PhoneInput from "@/components/phone-input";
import {
  ALT_CONTACT_RELATIONS,
  isValidPhone,
  toIntlPhone,
  toLocalPhone,
} from "@/lib/types";

// ============================================================
// «من ينوب عن العميل في التواصل» — يُضاف من ملفّ العميل مباشرة.
//
// كان الحقل موجوداً في نموذج العميل منذ sql/038، لكن النموذج كله
// خلف زرّ «تعديل» المخصوص بالمدير. والواقع أن الرقم يصل الموظف
// وهو مع عميله: «كلّم أخي، هذا رقمه». فكان يكتبه في الملاحظات أو
// يفقده، أو ينتظر مديراً ليكتب سطراً.
//
// فُصل هنا في مكوّن صغير يحرّر ثلاثة حقول لا العميل كله: يظهر لكل
// من يفتح الملف، ولا يفتح معه بقية بيانات العميل (المصدر، موظف
// المبيعات، المرحلة…) — تلك تبقى في شاشة التعديل.
//
// ⚠️ الحماية في القاعدة لا هنا: سياسة `update own clients`
// (sql/043) تسمح بالتعديل لمن أنشأ العميل أو يحمل الليد اسمه أو
// كان في نطاقه. من يفتح ملفّ زميلٍ لا يخصّه سيرى الزرّ ويصطدم
// برفض القاعدة — ولن تُكتب بيانات ليست له.
// ============================================================
export default function AltContact({
  clientId,
  name,
  phone,
  relation,
}: {
  clientId: string;
  name: string | null;
  phone: string | null;
  relation: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const has = Boolean(name?.trim() || phone?.trim());

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [f, setF] = useState({
    name: name ?? "",
    phone: phone ?? "",
    relation: relation ?? "",
  });

  // فتح النموذج يبدأ دائماً من المحفوظ، لا من مسودّة أُلغيت قبل قليل
  function start() {
    setF({ name: name ?? "", phone: phone ?? "", relation: relation ?? "" });
    setErr(null);
    setOpen(true);
  }

  async function save() {
    const cleanName = f.name.trim();
    const cleanPhone = f.phone.trim();

    if (!cleanName && !cleanPhone) {
      setErr("اكتب الاسم أو الرقم على الأقل.");
      return;
    }
    // رقمٌ ناقص أسوأ من لا رقم: يبقى في الملف يُتصل به فلا يردّ أحد
    if (cleanPhone && !isValidPhone(cleanPhone)) {
      setErr("رقم الهاتف غير مكتمل.");
      return;
    }

    setBusy(true);
    setErr(null);
    const { error } = await supabase
      .from("clients")
      .update({
        alt_contact_name: cleanName || null,
        alt_contact_phone: cleanPhone || null,
        alt_contact_relation: f.relation || null,
      })
      .eq("id", clientId);
    setBusy(false);

    if (error) {
      setErr("تعذّر الحفظ: " + error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("إزالة من ينوب عن العميل؟")) return;

    setBusy(true);
    setErr(null);
    const { error } = await supabase
      .from("clients")
      .update({
        alt_contact_name: null,
        alt_contact_phone: null,
        alt_contact_relation: null,
      })
      .eq("id", clientId);
    setBusy(false);

    if (error) {
      setErr("تعذّر الحذف: " + error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  // ===== النموذج =====
  if (open) {
    return (
      <div className="mt-5 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <span className="material-symbols-outlined text-[18px]">person_add</span>
          شخص ينوب عن العميل في التواصل
        </h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              الاسم
            </label>
            <input
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="اسم الشخص البديل"
              autoFocus
              className={input}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              صفته
            </label>
            <select
              value={f.relation}
              onChange={(e) => setF({ ...f, relation: e.target.value })}
              className={input}
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
            <label className="mb-1 block text-xs font-medium text-gray-600">
              رقم هاتفه
            </label>
            <PhoneInput
              value={f.phone}
              onChange={(v) => setF({ ...f, phone: v })}
            />
          </div>
        </div>

        {err && (
          <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
          <button
            onClick={() => setOpen(false)}
            disabled={busy}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
          >
            إلغاء
          </button>
          {has && (
            <button
              onClick={remove}
              disabled={busy}
              className="ms-auto text-xs text-gray-500 transition hover:text-red-600 disabled:opacity-50"
            >
              إزالة
            </button>
          )}
        </div>
      </div>
    );
  }

  // ===== لا يوجد بديل بعد: دعوةٌ لإضافته =====
  if (!has) {
    return (
      <button
        onClick={start}
        className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700"
      >
        <span className="material-symbols-outlined text-[18px]">person_add</span>
        + إضافة شخص ينوب عن العميل في التواصل
      </button>
    );
  }

  // ===== موجود: عرضه مع طريق التعديل =====
  return (
    <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
            <span className="material-symbols-outlined text-[16px]">person_add</span>
            ينوب عنه في التواصل
          </span>
          <p className="mt-1 font-medium text-gray-800">
            {name || "—"}
            {relation && (
              <span className="ms-2 rounded-full bg-white px-2 py-0.5 text-xs font-normal text-gray-500">
                {relation}
              </span>
            )}
          </p>
          {phone && (
            <span dir="ltr" className="block text-sm text-gray-500">
              {toLocalPhone(phone)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {phone && (
            <>
              <a
                href={`tel:${toIntlPhone(phone)}`}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
              >
                اتصال
              </a>
              <a
                href={`https://wa.me/${toIntlPhone(phone).replace("+", "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 transition hover:bg-green-100"
              >
                واتساب
              </a>
            </>
          )}
          <button
            onClick={start}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
          >
            تعديل
          </button>
        </div>
      </div>

      {err && (
        <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</p>
      )}
    </div>
  );
}
