"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  BrokerCompany,
  BrokerCompanyProject,
  Project,
  TeamMember,
} from "@/lib/types";

type Assignment = { project_id: string; rm_id: string };

// ============================================================
// نموذج الشركة الوسيطة: بياناتها ونسبة عمولتها وإسناداتها.
//
// الإسناد (مشروع + مدير علاقات) جزء من نفس النموذج لا شاشة منفصلة،
// لأن الشركة بلا مشروع لا تستطيع إدخال ليد أصلاً — فتركها لخطوة
// لاحقة يعني شركة معطّلة تنتظر خطوةً منسيّة.
// ============================================================
export default function CompanyForm({
  initial,
  companyId,
  projects,
  employees,
  assignments,
}: {
  initial?: Partial<BrokerCompany>;
  companyId?: string;
  projects: Project[];
  employees: TeamMember[];
  assignments?: BrokerCompanyProject[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = Boolean(companyId);

  const [form, setForm] = useState({
    name: initial?.name ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    license_no: initial?.license_no ?? "",
    commission_rate: initial?.commission_rate?.toString() ?? "2",
    notes: initial?.notes ?? "",
    is_active: initial?.is_active ?? true,
  });

  const [links, setLinks] = useState<Assignment[]>(
    (assignments ?? []).map((a) => ({
      project_id: a.project_id,
      rm_id: a.rm_id ?? "",
    }))
  );

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(field: keyof typeof form, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function addLink() {
    setLinks((prev) => [...prev, { project_id: "", rm_id: "" }]);
  }

  function setLink(i: number, patch: Partial<Assignment>) {
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function removeLink(i: number) {
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError("اكتب اسم الشركة.");
      return;
    }

    const rate = Number(form.commission_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      setError("نسبة العمولة بين ٠ و ١٠٠.");
      return;
    }

    const chosen = links.filter((l) => l.project_id);
    const unique = new Set(chosen.map((l) => l.project_id));
    if (unique.size !== chosen.length) {
      setError("لا تُسنِد الشركة لنفس المشروع مرتين.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      license_no: form.license_no.trim() || null,
      commission_rate: rate,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    };

    setSaving(true);

    let id = companyId;
    if (isEdit) {
      const { error } = await supabase
        .from("broker_companies")
        .update(payload)
        .eq("id", companyId!);
      if (error) {
        setSaving(false);
        setError("تعذّر الحفظ: " + error.message);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("broker_companies")
        .insert(payload)
        .select("id")
        .single();
      if (error || !data) {
        setSaving(false);
        setError(
          error?.message.includes("broker_companies_name_key")
            ? "توجد شركة بهذا الاسم فعلاً."
            : "تعذّر الحفظ: " + (error?.message ?? "خطأ غير معروف")
        );
        return;
      }
      id = data.id;
    }

    // الإسنادات: نحذف ما أُزيل ثم نُدرج/نحدّث الباقي
    const { error: delError } = await supabase
      .from("broker_company_projects")
      .delete()
      .eq("company_id", id!);

    if (delError) {
      setSaving(false);
      setError("حُفظت الشركة، لكن تعذّر تحديث إسناداتها: " + delError.message);
      return;
    }

    if (chosen.length > 0) {
      const { error: insError } = await supabase
        .from("broker_company_projects")
        .insert(
          chosen.map((l) => ({
            company_id: id!,
            project_id: l.project_id,
            rm_id: l.rm_id || null,
          }))
        );
      if (insError) {
        setSaving(false);
        setError("حُفظت الشركة، لكن تعذّر حفظ الإسنادات: " + insError.message);
        return;
      }
    }

    setSaving(false);
    router.push(`/dashboard/brokers/${id}`);
    router.refresh();
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const labelClass = "mb-1 block text-sm font-medium text-gray-700";
  const req = <span className="text-red-500">*</span>;

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-3xl space-y-6 rounded-2xl bg-white p-8 shadow-sm"
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={labelClass}>اسم الشركة {req}</label>
          <input
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>نسبة العمولة (٪) {req}</label>
          <input
            required
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={form.commission_rate}
            onChange={(e) => update("commission_rate", e.target.value)}
            className={inputClass}
            dir="ltr"
          />
          <p className="mt-1 text-xs text-gray-400">
            من سعر الوحدة عند إتمام البيع. تُثبَّت على كل عمولة وقت
            استحقاقها، فتغييرها لاحقاً لا يمسّ عمولات سابقة.
          </p>
        </div>

        <div>
          <label className={labelClass}>الهاتف</label>
          <input
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            className={inputClass}
            dir="ltr"
          />
        </div>

        <div>
          <label className={labelClass}>البريد الإلكتروني</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            className={inputClass}
            dir="ltr"
          />
        </div>

        <div>
          <label className={labelClass}>رقم إجازة المكتب</label>
          <input
            value={form.license_no}
            onChange={(e) => update("license_no", e.target.value)}
            className={inputClass}
          />
        </div>
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

      {/* الإسنادات */}
      <div className="rounded-xl border border-dashed border-gray-300 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-gray-800">المشاريع ومدير العلاقات</h3>
          <button
            type="button"
            onClick={addLink}
            className="rounded-lg border border-brand-600 px-3 py-1.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-50"
          >
            + إسناد مشروع
          </button>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          الشركة لا تستطيع إدخال ليد إلا في مشروع مُسنَد لها. ومدير العلاقات
          المختار هو من يتابع ليداتها في ذلك المشروع.
        </p>

        {links.length === 0 ? (
          <p className="text-sm text-amber-700">
            لم تُسنَد لأي مشروع بعد — لن تستطيع إدخال ليدات.
          </p>
        ) : (
          <div className="space-y-2">
            {links.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  value={l.project_id}
                  onChange={(e) => setLink(i, { project_id: e.target.value })}
                  className={inputClass + " max-w-xs"}
                >
                  <option value="">— اختر المشروع —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={l.rm_id}
                  onChange={(e) => setLink(i, { rm_id: e.target.value })}
                  className={inputClass + " max-w-xs"}
                >
                  <option value="">— بلا مدير علاقات —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeLink(i)}
                  className="text-sm text-red-600 hover:underline"
                >
                  إزالة
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-gray-400">
          ليصير الموظف مدير علاقات فعلياً غيّر دوره إلى «مدير علاقات» من{" "}
          <Link href="/dashboard/settings" className="font-semibold underline">
            الإعدادات
          </Link>
          .
        </p>
      </div>

      {isEdit && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => update("is_active", e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          شركة فعّالة
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
          {saving ? "جارٍ الحفظ..." : isEdit ? "حفظ التعديلات" : "إنشاء الشركة"}
        </button>
        <Link
          href={isEdit ? `/dashboard/brokers/${companyId}` : "/dashboard/brokers"}
          className="rounded-lg border border-gray-300 px-6 py-2.5 text-gray-600 transition hover:bg-gray-100"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
