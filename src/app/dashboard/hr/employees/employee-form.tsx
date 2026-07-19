"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Employee } from "@/lib/types";

type AccountOption = { id: string; email: string | null };

// نموذج إضافة/تعديل موظف (للمدير)
export default function EmployeeForm({
  accounts,
  initial,
  employeeId,
}: {
  accounts: AccountOption[];
  initial?: Partial<Employee>;
  employeeId?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = Boolean(employeeId);

  const [form, setForm] = useState({
    full_name: initial?.full_name ?? "",
    job_title: initial?.job_title ?? "",
    department: initial?.department ?? "",
    phone: initial?.phone ?? "",
    hire_date: initial?.hire_date ?? "",
    base_salary: initial?.base_salary?.toString() ?? "",
    status: initial?.status ?? "active",
    user_id: initial?.user_id ?? "",
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

    const payload = {
      full_name: form.full_name.trim(),
      job_title: form.job_title.trim() || null,
      department: form.department.trim() || null,
      phone: form.phone.trim() || null,
      hire_date: form.hire_date || null,
      base_salary: form.base_salary ? Number(form.base_salary) : 0,
      status: form.status,
      user_id: form.user_id || null,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    const { error } = isEdit
      ? await supabase.from("employees").update(payload).eq("id", employeeId!)
      : await supabase.from("employees").insert(payload);
    setSaving(false);

    if (error) {
      setError(
        error.message.includes("duplicate")
          ? "هذا الحساب مرتبط بموظف آخر بالفعل."
          : "تعذّر الحفظ: " + error.message
      );
      return;
    }

    router.push(isEdit ? `/dashboard/hr/employees/${employeeId}` : "/dashboard/hr/employees");
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
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>الاسم الكامل {req}</label>
          <input
            type="text"
            required
            value={form.full_name}
            onChange={(e) => update("full_name", e.target.value)}
            className={inputClass}
            placeholder="اسم الموظف"
          />
        </div>

        <div>
          <label className={labelClass}>المسمّى الوظيفي</label>
          <input
            type="text"
            value={form.job_title}
            onChange={(e) => update("job_title", e.target.value)}
            className={inputClass}
            placeholder="مثال: موظف مبيعات"
          />
        </div>

        <div>
          <label className={labelClass}>القسم</label>
          <input
            type="text"
            value={form.department}
            onChange={(e) => update("department", e.target.value)}
            className={inputClass}
            placeholder="مثال: المبيعات"
          />
        </div>

        <div>
          <label className={labelClass}>رقم الهاتف</label>
          <input
            type="tel"
            dir="ltr"
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            className={inputClass + " text-left"}
            placeholder="07xxxxxxxxx"
          />
        </div>

        <div>
          <label className={labelClass}>
            تاريخ المباشرة {req}
          </label>
          <input
            type="date"
            required
            dir="ltr"
            value={form.hire_date}
            onChange={(e) => update("hire_date", e.target.value)}
            className={inputClass + " text-left"}
          />
          <p className="mt-1 text-xs text-gray-400">
            يوم بداية العمل الفعلي — منه تُحتسب الرواتب والحضور.
          </p>
        </div>

        <div>
          <label className={labelClass}>الراتب الأساسي (د.ع) {req}</label>
          <input
            type="number"
            required
            min="0"
            step="any"
            dir="ltr"
            value={form.base_salary}
            onChange={(e) => update("base_salary", e.target.value)}
            className={inputClass + " text-left"}
            placeholder="مثال: 1000000"
          />
        </div>

        <div>
          <label className={labelClass}>الحالة</label>
          <select
            value={form.status}
            onChange={(e) => update("status", e.target.value)}
            className={inputClass}
          >
            <option value="active">على رأس العمل</option>
            <option value="inactive">غير نشط</option>
          </select>
        </div>

        {/* ربط بحساب الدخول */}
        <div className="sm:col-span-2">
          <label className={labelClass}>ربط بحساب دخول (اختياري)</label>
          <select
            value={form.user_id}
            onChange={(e) => update("user_id", e.target.value)}
            className={inputClass}
          >
            <option value="">— بدون ربط —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            اربط الموظف بحسابه ليتمكّن من الدخول ورؤية بياناته في بوابة الموظف.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>ملاحظات</label>
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            className={inputClass}
            placeholder="أي تفاصيل إضافية..."
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
          {saving ? "جاري الحفظ..." : isEdit ? "حفظ التعديلات" : "حفظ الموظف"}
        </button>
        <Link
          href="/dashboard/hr/employees"
          className="rounded-lg border border-gray-300 px-6 py-2.5 font-medium text-gray-700 transition hover:bg-gray-100"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
