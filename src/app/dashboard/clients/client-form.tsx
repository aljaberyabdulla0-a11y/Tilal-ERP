"use client";

import { useEffect, useState } from "react";
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
  isValidPhone,
} from "@/lib/types";
import type { ClientMatch } from "@/lib/crm";
import PhoneInput from "@/components/phone-input";
import ClientMatchList from "@/components/client-match-list";

// ما يُفعل بالبطاقة الجديدة بعد حفظها، حين وُجد الشخص مسبقاً (sql/104)
type AfterCreate =
  | { kind: "merge"; into: string }        // أضفها إلى الموجودة ← شاشة الدمج
  | { kind: "request"; with: string }      // الموجودة لزميل ← طلب دمج للإدارة
  | { kind: "not_same"; others: string[] } // ليس الشخص نفسه ← لا يعود التنبيه
  | { kind: "none" };

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
  sources,
  campaigns = [],
}: {
  initial?: Partial<Client>;
  clientId?: string;
  // Running marketing campaigns — the employee picks the one the client came from, so the campaign
  // knows its leads and its sales (marketing's attribution is built on it). Optional.
  campaigns?: { id: string; name: string }[];
  // أسماء الموظفين المتاحة — الاسم هنا يحدّد من يشوف هذا العميل،
  // فلازم يطابق ملف الموظفين حرفياً (لذلك قائمة وليس كتابة حرة)
  employeeNames?: string[];
  // مصادر العملاء من crm_sources (sql/070) — تسقط إلى الثابت القديم
  sources?: string[];
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
    campaign_id: initial?.campaign_id ?? "",
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

  // ===== «هذا الشخص موجود» — في الإضافة وحدها =====
  // phoneHits: تنبيهٌ مبكر تحت حقل الرقم أثناء الكتابة.
  // gate: البطاقات المطابقة عند الحفظ — تُوقف الحفظ حتى يختار الموظف.
  const [phoneHits, setPhoneHits] = useState<ClientMatch[]>([]);
  const [gate, setGate] = useState<ClientMatch[] | null>(null);

  useEffect(() => {
    if (isEdit || !isValidPhone(form.phone)) {
      setPhoneHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("find_client_matches", { p_phone: form.phone });
      setPhoneHits((data ?? []) as ClientMatch[]);
    }, 400);
    return () => clearTimeout(t);
    // supabase ثابت عملياً؛ إضافته تعيد الاستدعاء في كل رسم
  }, [form.phone, isEdit]);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setGate(null);
  }

  // القائمة المعروضة — نضيف لها القيمة المحفوظة سابقاً إن كانت
  // لموظف قديم لم يعد في القائمة، حتى لا تضيع عند التعديل
  const options = Array.from(
    new Set([...employeeNames, form.sales_employee].filter(Boolean))
  );
  // المصدر المحفوظ سابقاً يبقى في القائمة ولو عُطّل لاحقاً
  const sourceOptions = Array.from(
    new Set([...(sources && sources.length > 0 ? sources : CLIENT_SOURCES), form.source].filter(Boolean))
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.phone && !isValidPhone(form.phone)) {
      setError(
        "رقم الهاتف غير مكتمل. تأكّد من مفتاح الدولة وعدد الأرقام — الافتراضي عراقي: 11 رقماً يبدأ بـ 07."
      );
      return;
    }

    // رقم البديل اختياري، لكن إن كُتب فيجب أن يكون صحيحاً — رقم خاطئ
    // محفوظ أسوأ من لا رقم: الموظف سيتصل به ويظنّ العميل لا يردّ.
    if (form.alt_contact_phone && !isValidPhone(form.alt_contact_phone)) {
      setError(
        "رقم جهة الاتصال البديلة غير مكتمل. اتركه فارغاً، أو تأكّد من مفتاح الدولة وعدد الأرقام."
      );
      return;
    }

    // قبل إنشاء بطاقة: هل الشخص مسجّل؟ الرقم والرقم البديل والاسم معاً.
    // فشل الفحص لا يمنع الحفظ — المحفّز في القاعدة يرصد التكرار على أي حال.
    if (!isEdit) {
      setSaving(true);
      const { data } = await supabase.rpc("find_client_matches", {
        p_phone: form.phone.trim() || null,
        p_alt_phone: form.alt_contact_phone.trim() || null,
        p_name: form.name.trim() || null,
      });
      setSaving(false);
      const found = (data ?? []) as ClientMatch[];
      if (found.length > 0) {
        setGate(found);
        return;
      }
    }

    await save({ kind: "none" });
  }

  async function save(after: AfterCreate) {
    setError(null);
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
      // Only when there's a campaign list: an edit page without one doesn't erase a campaign set earlier
      ...(campaigns.length > 0 || form.campaign_id ? { campaign_id: form.campaign_id || null } : {}),
      payment_method: form.payment_method || null,
      sales_employee: form.sales_employee.trim() || null,
      entry_date: form.entry_date || null,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    // نفس النموذج يخدم الحالتين: تعديل أو إضافة
    if (isEdit) {
      const { error } = await supabase.from("clients").update(payload).eq("id", clientId!);
      setSaving(false);
      if (error) return setError("تعذّر الحفظ: " + error.message);
      router.push(`/dashboard/clients/${clientId}`);
      router.refresh();
      return;
    }

    const { data: created, error } = await supabase.from("clients").insert(payload).select("id").single();
    if (error || !created) {
      setSaving(false);
      return setError("تعذّر الحفظ: " + (error?.message ?? "لم تُرجع القاعدة البطاقة"));
    }
    const newId = created.id as string;

    // البطاقة حُفظت. ما بعدها خطوة إضافية: فشلها لا يُلغي الحفظ، بل
    // يُنقل الموظف إلى بطاقته ويُقال له ما لم يتمّ.
    let next = "/dashboard/clients";
    if (after.kind === "merge") {
      // من البطاقة الجديدة: بطاقة الزميل لا تُفتح لكاتبها، وشاشة الدمج
      // تقرؤها عبر client_merge_peer (169). الباقية الافتراضية = الأقدم.
      next = `/dashboard/clients/${newId}/merge?with=${after.into}`;
    } else if (after.kind === "request") {
      const { error: e2 } = await supabase.rpc("request_client_merge", {
        p_a: newId,
        p_b: after.with,
        p_note: "أُنشئت البطاقة رغم وجود بطاقة سابقة قد تكون للشخص نفسه.",
      });
      next = `/dashboard/clients/${newId}`;
      if (e2) alert("حُفظت البطاقة، لكن تعذّر إرسال طلب الدمج: " + e2.message);
    } else if (after.kind === "not_same") {
      await Promise.all(
        after.others.map((o) =>
          supabase.rpc("resolve_client_duplicate", { p_a: newId, p_b: o, p_status: "ليسا واحداً" })
        )
      );
    }
    setSaving(false);
    router.push(next);
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

        {/* رقم الهاتف — العراق افتراضياً، وبقية الدول متاحة */}
        <div className="sm:col-span-2">
          <label className={labelClass}>رقم الهاتف {req}</label>
          <PhoneInput
            required
            value={form.phone}
            onChange={(v) => update("phone", v)}
          />
          {/* تنبيهٌ مبكر: قبل أن يملأ الموظف بقية النموذج */}
          {phoneHits.length > 0 && !gate && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="mb-2 font-semibold">
                هذا الرقم مسجّل مسبقاً — تأكّد أنك لا تُنشئ بطاقة ثانية للشخص نفسه:
              </p>
              <ClientMatchList matches={phoneHits} />
            </div>
          )}
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
                  <PhoneInput
                    value={form.alt_contact_phone}
                    onChange={(v) => update("alt_contact_phone", v)}
                  />
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
            {sourceOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* The marketing campaign — when the client came from an ad or a campaign activity */}
        {(campaigns.length > 0 || form.campaign_id) && (
          <div>
            <label className={labelClass}>الحملة التسويقية</label>
            <select
              value={form.campaign_id}
              onChange={(e) => update("campaign_id", e.target.value)}
              className={inputClass}
            >
              <option value="">— لا حملة / لا أعرف —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {form.campaign_id && !campaigns.some((c) => c.id === form.campaign_id) && (
                <option value={form.campaign_id}>الحملة المسجّلة سابقاً</option>
              )}
            </select>
            <p className="mt-1 text-xs text-gray-400">إن قال العميل إنه رأى إعلاناً — اختر حملته، فيُحسب الليد لها.</p>
          </div>
        )}

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

      {/* ===== «هذا الشخص موجود» — الحفظ متوقّف حتى يختار الموظف ===== */}
      {gate && (
        <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div>
            <h3 className="font-bold text-amber-900">هذا الشخص موجود على الأغلب</h3>
            <p className="text-sm text-amber-800">
              وجدنا {gate.length === 1 ? "بطاقة" : `${gate.length} بطاقات`} قد تكون له. بطاقتان للشخص نفسه تقسمان
              تاريخه على اثنتين وتحسبانه ليدين — اختر ما تريد:
            </p>
          </div>

          <ClientMatchList
            matches={gate}
            actions={(m) =>
              m.can_merge ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => save({ kind: "merge", into: m.id })}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  ادمج معلوماتي في هذه البطاقة
                </button>
              ) : (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => save({ kind: "request", with: m.id })}
                  className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  احفظ واطلب الدمج من المشرف
                </button>
              )
            }
          />

          <p className="text-xs text-amber-800">
            «ادمج» يحفظ ما كتبته ثم يفتح شاشة المقارنة لتختار حقلاً حقلاً ما يبقى — ولو كانت البطاقة عند زميل، ما
            دام الرقم أو الاسم نفسه. وحينها يبقى العميل لصاحب البطاقة الأقدم، وتبقى أنت ترى البطاقة. وإن لم يتطابقا،
            تُحفظ بطاقتك ويصل طلب الدمج إلى مشرف الفريق.
          </p>

          <div className="flex flex-wrap gap-2 border-t border-amber-200 pt-3">
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                save({
                  kind: "not_same",
                  others: gate.filter((m) => m.can_merge && m.match_type !== "مرشّح").map((m) => m.id),
                })
              }
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:border-gray-500 disabled:opacity-50"
            >
              ليس الشخص نفسه — أنشئ بطاقة جديدة
            </button>
            <button
              type="button"
              onClick={() => setGate(null)}
              className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:text-gray-800"
            >
              رجوع للتعديل
            </button>
          </div>
        </div>
      )}

      <div className={`flex gap-3 ${gate ? "hidden" : ""}`}>
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
