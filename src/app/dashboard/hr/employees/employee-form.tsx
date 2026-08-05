"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { CompanySettings, Employee } from "@/lib/types";
import { WEEKDAYS } from "@/lib/attendance";

type AccountOption = { id: string; email: string | null };

// نموذج إضافة/تعديل موظف (للمدير)
export default function EmployeeForm({
  accounts,
  initial,
  employeeId,
  settings,
}: {
  accounts: AccountOption[];
  initial?: Partial<Employee>;
  employeeId?: string;
  settings?: CompanySettings | null;
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

  // الدوام: إمّا يتبع دوام الشركة، أو دوام خاص بهذا الموظف
  const [exempt, setExempt] = useState(initial?.exempt_from_attendance ?? false);
  const [customHours, setCustomHours] = useState(
    Boolean(initial?.work_start_time && initial?.work_end_time)
  );
  const [startTime, setStartTime] = useState(
    (initial?.work_start_time ?? settings?.work_start_time ?? "09:00:00").slice(0, 5)
  );
  const [endTime, setEndTime] = useState(
    (initial?.work_end_time ?? settings?.work_end_time ?? "17:00:00").slice(0, 5)
  );
  const [customDays, setCustomDays] = useState(
    Boolean(initial?.work_days && initial.work_days.length > 0)
  );
  const [days, setDays] = useState<number[]>(
    initial?.work_days ?? settings?.work_days ?? [0, 1, 2, 3, 4]
  );

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleDay(value: number) {
    setDays((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value].sort()
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (customHours && endTime <= startTime) {
      setError("وقت نهاية الدوام يجب أن يكون بعد وقت البداية.");
      return;
    }
    if (customDays && days.length === 0) {
      setError("اختر يوم دوام واحد على الأقل، أو ارجع لأيام دوام الشركة.");
      return;
    }

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
      exempt_from_attendance: exempt,
      // فارغ = يتبع دوام الشركة العام
      work_start_time: customHours ? startTime : null,
      work_end_time: customHours ? endTime : null,
      work_days: customDays ? days : null,
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

      {/* ===== الدوام والبصمة ===== */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
        <h3 className="font-semibold text-gray-800">الدوام والبصمة</h3>

        {/* إعفاء من البصمة */}
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-white p-4">
          <input
            type="checkbox"
            checked={exempt}
            onChange={(e) => setExempt(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-600"
          />
          <span>
            <span className="block text-sm font-medium text-gray-800">
              معفى من البصمة
            </span>
            <span className="block text-xs text-gray-500">
              للإدارة ومن لا يلتزم بدوام ثابت — لا يُحتسب عليه غياب ولا تأخير، ولا يظهر
              له زر البصمة في بوابة الموظف.
            </span>
          </span>
        </label>

        {!exempt && (
          <>
            {/* أوقات دوام خاصة */}
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg bg-white p-4">
              <input
                type="checkbox"
                checked={customHours}
                onChange={(e) => setCustomHours(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand-600"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">
                  أوقات دوام خاصة بهذا الموظف
                </span>
                <span className="block text-xs text-gray-500">
                  بدون تفعيلها يتبع دوام الشركة العام (
                  <span dir="ltr">
                    {(settings?.work_start_time ?? "09:00:00").slice(0, 5)} –{" "}
                    {(settings?.work_end_time ?? "17:00:00").slice(0, 5)}
                  </span>
                  ).
                </span>
              </span>
            </label>

            {customHours && (
              <div className="mt-3 grid grid-cols-1 gap-4 rounded-lg bg-white p-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>بداية الدوام</label>
                  <input
                    type="time"
                    dir="ltr"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className={inputClass + " text-left"}
                  />
                </div>
                <div>
                  <label className={labelClass}>نهاية الدوام</label>
                  <input
                    type="time"
                    dir="ltr"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className={inputClass + " text-left"}
                  />
                </div>
              </div>
            )}

            {/* أيام دوام خاصة */}
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg bg-white p-4">
              <input
                type="checkbox"
                checked={customDays}
                onChange={(e) => setCustomDays(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand-600"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">
                  أيام دوام خاصة بهذا الموظف
                </span>
                <span className="block text-xs text-gray-500">
                  بدون تفعيلها يتبع أيام دوام الشركة.
                </span>
              </span>
            </label>

            {customDays && (
              <div className="mt-3 flex flex-wrap gap-2 rounded-lg bg-white p-4">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDay(d.value)}
                    className={
                      days.includes(d.value)
                        ? "rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
                        : "rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-500 transition hover:bg-gray-50"
                    }
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
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
