"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { CompanySettings, Employee, Project } from "@/lib/types";
import { WEEKDAYS } from "@/lib/attendance";
import { Branch, Department, EmploymentType, Position, departmentLabel } from "@/lib/org-types";

type AccountOption = { id: string; email: string | null };
type PersonOption = { id: string; full_name: string; employee_code: string };
export type OrgLookups = {
  departments: Department[];
  positions: Position[];
  branches: Branch[];
  employmentTypes: EmploymentType[];
};

// نموذج إضافة/تعديل موظف (للمدير)
export default function EmployeeForm({
  accounts,
  initial,
  employeeId,
  settings,
  projects = [],
  org,
  people = [],
  roleNames,
}: {
  accounts: AccountOption[];
  initial?: Partial<Employee>;
  employeeId?: string;
  settings?: CompanySettings | null;
  projects?: Project[];
  org?: OrgLookups;
  people?: PersonOption[];
  roleNames?: Record<string, string>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = Boolean(employeeId);

  const [form, setForm] = useState({
    full_name: initial?.full_name ?? "",
    job_title: initial?.job_title ?? "",
    department_id: initial?.department_id ?? "",
    position_id: initial?.position_id ?? "",
    manager_id: initial?.manager_id ?? "",
    branch_id: initial?.branch_id ?? org?.branches[0]?.id ?? "",
    employment_type: initial?.employment_type ?? "full_time",
    employee_code: initial?.employee_code ?? "",
    phone: initial?.phone ?? "",
    hire_date: initial?.hire_date ?? "",
    base_salary: initial?.base_salary?.toString() ?? "",
    commission_rate: initial?.commission_rate?.toString() ?? "",
    status: initial?.status ?? "active",
    user_id: initial?.user_id ?? "",
    project_id: initial?.project_id ?? "",
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

  // اختيار المنصب يملأ القسم ونوع التوظيف منه — ويبقى تعديلهما ممكناً (الندب)
  function choosePosition(id: string) {
    const p = org?.positions.find((x) => x.id === id);
    setForm((prev) => ({
      ...prev,
      position_id: id,
      department_id: p ? p.department_id : prev.department_id,
      employment_type: p ? p.employment_type : prev.employment_type,
      job_title: p ? p.title_ar : prev.job_title,
    }));
  }
  const chosen = org?.positions.find((x) => x.id === form.position_id);
  const suggestedRole = chosen?.default_role_code ? roleNames?.[chosen.default_role_code] ?? chosen.default_role_code : null;

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
      // القسم والمسمّى النصّيان يشتقّهما محفّز القاعدة من المرجعين (sql/145)
      department_id: form.department_id || null,
      position_id: form.position_id || null,
      manager_id: form.manager_id || null,
      branch_id: form.branch_id || null,
      employment_type: form.employment_type || null,
      // فارغ = تولّد القاعدة رمزاً تلقائياً (لا يُرسل فارغاً فيُستبدل رمزٌ قائم)
      ...(form.employee_code.trim() ? { employee_code: form.employee_code.trim() } : {}),
      phone: form.phone.trim() || null,
      hire_date: form.hire_date || null,
      base_salary: form.base_salary ? Number(form.base_salary) : 0,
      // فارغة = يتبع نسبة الشركة، لا صفراً يُلغي عمولته
      commission_rate: form.commission_rate ? Number(form.commission_rate) : null,
      status: form.status,
      user_id: form.user_id || null,
      project_id: form.project_id || null,
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

        {/* ===== الهيكل التنظيمي (sql/145) ===== */}
        <div>
          <label className={labelClass}>المنصب</label>
          <select
            value={form.position_id}
            onChange={(e) => choosePosition(e.target.value)}
            className={inputClass}
          >
            <option value="">— بلا منصب —</option>
            {(org?.departments ?? []).map((d) => {
              const items = (org?.positions ?? []).filter((p) => p.department_id === d.id);
              if (items.length === 0) return null;
              return (
                <optgroup key={d.id} label={departmentLabel(d, org?.departments ?? [])}>
                  {items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title_ar}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          {suggestedRole && (
            <p className="mt-1 text-xs text-gray-400">
              الدور المقترح لهذا المنصب: {suggestedRole} — يُعيَّن من الإعدادات، لا تلقائياً.
            </p>
          )}
        </div>

        {/* المسمّى الحرّ لمن لا منصب له — مع المنصب يُشتق منه */}
        {!form.position_id && (
          <div>
            <label className={labelClass}>المسمّى الوظيفي</label>
            <input
              type="text"
              value={form.job_title}
              onChange={(e) => update("job_title", e.target.value)}
              className={inputClass}
              placeholder="يُفضَّل اختيار منصب"
            />
          </div>
        )}

        <div>
          <label className={labelClass}>القسم</label>
          <select
            value={form.department_id}
            onChange={(e) => update("department_id", e.target.value)}
            className={inputClass}
          >
            <option value="">— بلا قسم —</option>
            {(org?.departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {departmentLabel(d, org?.departments ?? [])}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>المدير المباشر</label>
          <select
            value={form.manager_id}
            onChange={(e) => update("manager_id", e.target.value)}
            className={inputClass}
          >
            <option value="">— بلا مدير مباشر —</option>
            {people
              .filter((p) => p.id !== employeeId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({p.employee_code})
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>نوع التوظيف</label>
          <select
            value={form.employment_type}
            onChange={(e) => update("employment_type", e.target.value)}
            className={inputClass}
          >
            {(org?.employmentTypes ?? []).map((t) => (
              <option key={t.code} value={t.code}>
                {t.name_ar}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>الفرع</label>
          <select
            value={form.branch_id}
            onChange={(e) => update("branch_id", e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {(org?.branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name_ar}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>الرقم الوظيفي</label>
          <input
            type="text"
            dir="ltr"
            value={form.employee_code}
            onChange={(e) => update("employee_code", e.target.value.toUpperCase())}
            className={inputClass + " text-start"}
            placeholder="يُولَّد تلقائياً"
          />
        </div>

        <div>
          <label className={labelClass}>المشروع</label>
          <select
            value={form.project_id}
            onChange={(e) => update("project_id", e.target.value)}
            className={inputClass}
          >
            <option value="">— بلا مشروع —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            مشرف هذا المشروع سيرى ليدات الموظف ومتابعاته وحضوره.
          </p>
        </div>

        <div>
          <label className={labelClass}>رقم الهاتف</label>
          <input
            type="tel"
            dir="ltr"
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            className={inputClass + " text-start"}
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
            className={inputClass + " text-start"}
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
            className={inputClass + " text-start"}
            placeholder="مثال: 1000000"
          />
        </div>

        <div>
          <label className={labelClass}>نسبة العمولة الخاصة (%)</label>
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            dir="ltr"
            value={form.commission_rate}
            onChange={(e) => update("commission_rate", e.target.value)}
            className={inputClass + " text-start"}
            placeholder="اتركه فارغاً ليتبع نسبة الشركة"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            تسبق نسبة الشركة عند احتساب عمولة الفواتير المسدَّدة.
          </p>
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
                    className={inputClass + " text-start"}
                  />
                </div>
                <div>
                  <label className={labelClass}>نهاية الدوام</label>
                  <input
                    type="time"
                    dir="ltr"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className={inputClass + " text-start"}
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
