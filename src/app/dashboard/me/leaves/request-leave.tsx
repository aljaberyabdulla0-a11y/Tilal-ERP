"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LEAVE_TYPES,
  LEAVE_DURATION_TYPES,
  daysBetween,
  hoursBetween,
  formatHours,
} from "@/lib/types";

// نموذج طلب إجازة (للموظف) — يوم كامل أو إجازة زمنية بالساعات
export default function RequestLeave({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState({
    leave_type: "سنوية",
    duration_type: "يوم كامل",
    start_date: "",
    end_date: "",
    start_time: "",
    end_time: "",
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const hourly = form.duration_type === "ساعات";

  const days =
    !hourly && form.start_date && form.end_date
      ? daysBetween(form.start_date, form.end_date)
      : 0;
  const hours =
    hourly && form.start_time && form.end_time
      ? hoursBetween(form.start_time, form.end_time)
      : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (hourly) {
      if (hours <= 0) {
        setError("تأكّد أن وقت النهاية بعد وقت البداية.");
        return;
      }
    } else if (days <= 0) {
      setError("تأكّد أن تاريخ النهاية بعد تاريخ البداية.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("leaves").insert({
      employee_id: employeeId,
      leave_type: form.leave_type,
      duration_type: form.duration_type,
      start_date: form.start_date,
      // الإجازة الزمنية داخل يوم واحد — القاعدة تضبط النهاية على نفس اليوم
      end_date: hourly ? form.start_date : form.end_date,
      start_time: hourly ? form.start_time : null,
      end_time: hourly ? form.end_time : null,
      days: hourly ? 0 : days,
      hours: hourly ? hours : null,
      reason: form.reason.trim() || null,
      status: "معلقة",
    });
    setSaving(false);
    if (error) {
      setError("تعذّر إرسال الطلب: " + error.message);
      return;
    }
    setForm({
      leave_type: "سنوية",
      duration_type: form.duration_type,
      start_date: "",
      end_date: "",
      start_time: "",
      end_time: "",
      reason: "",
    });
    router.refresh();
  }

  const cls =
    "w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const labelClass = "mb-1 block text-sm font-medium text-gray-700";

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-gray-800">طلب إجازة جديدة</h3>

      {/* اختيار المدّة: يوم كامل أو ساعات */}
      <div className="mb-4">
        <label className={labelClass}>مدّة الإجازة</label>
        <div className="flex gap-2">
          {LEAVE_DURATION_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => update("duration_type", t)}
              className={
                form.duration_type === t
                  ? "rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
              }
            >
              {t === "ساعات" ? "إجازة زمنية (ساعات)" : "يوم كامل"}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-500">
          {hourly
            ? "إجازة لبضع ساعات داخل يوم واحد — مثل الخروج لمراجعة أو موعد."
            : "إجازة ليوم كامل أو أكثر."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>نوع الإجازة</label>
          <select
            value={form.leave_type}
            onChange={(e) => update("leave_type", e.target.value)}
            className={cls}
          >
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <p className="text-sm text-gray-500">
            {hourly ? (
              <>
                المدّة: <b className="text-gray-800">{hours ? formatHours(hours) : "—"}</b>
              </>
            ) : (
              <>
                عدد الأيام: <b className="text-gray-800">{days || "—"}</b>
              </>
            )}
          </p>
        </div>

        {hourly ? (
          <>
            <div>
              <label className={labelClass}>التاريخ</label>
              <input
                type="date"
                required
                dir="ltr"
                value={form.start_date}
                onChange={(e) => update("start_date", e.target.value)}
                className={cls + " text-left"}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>من الساعة</label>
                <input
                  type="time"
                  required
                  dir="ltr"
                  value={form.start_time}
                  onChange={(e) => update("start_time", e.target.value)}
                  className={cls + " text-left"}
                />
              </div>
              <div>
                <label className={labelClass}>إلى الساعة</label>
                <input
                  type="time"
                  required
                  dir="ltr"
                  value={form.end_time}
                  onChange={(e) => update("end_time", e.target.value)}
                  className={cls + " text-left"}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelClass}>من تاريخ</label>
              <input
                type="date"
                required
                dir="ltr"
                value={form.start_date}
                onChange={(e) => update("start_date", e.target.value)}
                className={cls + " text-left"}
              />
            </div>
            <div>
              <label className={labelClass}>إلى تاريخ</label>
              <input
                type="date"
                required
                dir="ltr"
                value={form.end_date}
                onChange={(e) => update("end_date", e.target.value)}
                className={cls + " text-left"}
              />
            </div>
          </>
        )}

        <div className="sm:col-span-2">
          <label className={labelClass}>السبب</label>
          <textarea
            rows={2}
            value={form.reason}
            onChange={(e) => update("reason", e.target.value)}
            className={cls}
            placeholder="سبب الإجازة (اختياري)"
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="mt-4 rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? "جاري الإرسال..." : "إرسال الطلب"}
      </button>

      <p className="mt-3 text-xs text-gray-400">
        سيصل إشعار للإدارة فور إرسال الطلب، ويصلك إشعار عند الموافقة أو الرفض.
      </p>
    </form>
  );
}
