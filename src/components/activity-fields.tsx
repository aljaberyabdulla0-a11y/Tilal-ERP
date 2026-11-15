"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ACTIVITY_DIRECTIONS,
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  activityMeta,
  isClosedStage,
} from "@/lib/types";
import type { ActivityFormState } from "@/lib/activity-form";
import {
  type FollowupDayStatus,
  arDayName,
  followupDayHint,
} from "@/lib/followup-rules";

// ============================================================
// حقول تسجيل التواصل — مشتركة بين نموذج التسجيل ونموذج التعديل.
// منطق التحقّق في src/lib/activity-form.ts.
// ============================================================

export default function ActivityFields({
  value,
  onChange,
  showTypePicker = false,
  stage,
  clientId,
  originalNextDate,
}: {
  value: ActivityFormState;
  onChange: (next: ActivityFormState) => void;
  // يظهر في التعديل فقط — التسجيل يختار النوع من الأزرار السريعة
  showTypePicker?: boolean;
  // مرحلة العميل — تُخفي المتابعة إذا كان الملف مغلقاً (بيع/فشل البيع)
  stage?: string | null;
  // العميل — لعرض حِمل يوم المتابعة عند مالكه (sql/225). بلا عميل: فحص الجمعة فقط
  clientId?: string | null;
  // موعد السجلّ قبل التعديل — موعد لم يتغيّر لا يُفحص
  originalNextDate?: string | null;
}) {
  const meta = activityMeta(value.activity_type);
  const closed = isClosedStage(stage);
  // حالة يوم المتابعة المختار: كم متابعة فيه للموظف، وهل امتلأ
  const nextDate = closed ? "" : value.next_date;
  const unchanged = !!originalNextDate && nextDate === originalNextDate;
  const [dayStatus, setDayStatus] = useState<{ date: string; status: FollowupDayStatus } | null>(null);

  useEffect(() => {
    if (!clientId || !nextDate || unchanged) return;
    let cancelled = false;
    createClient()
      .rpc("followup_day_status", { p_client: clientId, p_date: nextDate })
      .then(({ data, error }) => {
        // خطأ (القاعدة لم تُحدَّث بعد) أو لا صلاحية: بلا عدّاد — الحفظ يفحص
        if (cancelled || error || !data) return;
        setDayStatus({ date: nextDate, status: data as FollowupDayStatus });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, nextDate, unchanged]);

  const hint = unchanged
    ? null
    : followupDayHint(nextDate, dayStatus?.date === nextDate ? dayStatus.status : null);

  const set = <K extends keyof ActivityFormState>(key: K, v: ActivityFormState[K]) =>
    onChange({ ...value, [key]: v });

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const label = "mb-1 block text-xs font-medium text-gray-600";
  const req = <span className="text-red-500">*</span>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {showTypePicker && (
          <div>
            <label className={label}>نوع التواصل</label>
            <select
              value={value.activity_type}
              onChange={(e) => set("activity_type", e.target.value)}
              className={input}
            >
              {ACTIVITY_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.key}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className={label}>التاريخ</label>
          <input
            type="date"
            dir="ltr"
            value={value.date}
            onChange={(e) => set("date", e.target.value)}
            className={input + " text-start"}
          />
        </div>

        <div>
          <label className={label}>الوقت</label>
          <input
            type="time"
            dir="ltr"
            value={value.time}
            onChange={(e) => set("time", e.target.value)}
            className={input + " text-start"}
          />
        </div>

        {meta.hasDirection && (
          <div>
            <label className={label}>الاتجاه</label>
            <select
              value={value.direction}
              onChange={(e) => set("direction", e.target.value)}
              className={input}
            >
              {ACTIVITY_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {d === "صادر" ? "منّا للعميل" : "من العميل إلينا"}
                </option>
              ))}
            </select>
          </div>
        )}

        {meta.hasDuration && (
          <div>
            <label className={label}>المدة (دقيقة)</label>
            <input
              type="number"
              min={0}
              max={1440}
              dir="ltr"
              value={value.duration}
              onChange={(e) => set("duration", e.target.value)}
              className={input + " text-start"}
              placeholder="مثال: 10"
            />
          </div>
        )}

        {value.activity_type !== "ملاحظة" && (
          <div>
            <label className={label}>النتيجة</label>
            <select
              value={value.outcome}
              onChange={(e) => set("outcome", e.target.value)}
              className={input}
            >
              {ACTIVITY_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className={label}>ماذا دار في التواصل؟</label>
        <textarea
          rows={2}
          value={value.summary}
          onChange={(e) => set("summary", e.target.value)}
          className={input}
          placeholder="مثال: سأل عن شقة ثلاث غرف في المنصور، وسعرها ضمن ميزانيته."
        />
      </div>

      {/* ملف مغلق (بيع / فشل البيع) — لا متابعة بعده */}
      {closed ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          <span className="material-symbols-outlined text-[18px] text-gray-400">
            task_alt
          </span>
          <span>
            حالة العميل «{stage}» — لا حاجة لخطوة قادمة ولا موعد متابعة.
          </span>
        </div>
      ) : (
      /* المتابعة القادمة — الموعد إلزامي */
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>الخطوة القادمة</label>
            <input
              type="text"
              value={value.next_action}
              onChange={(e) => set("next_action", e.target.value)}
              className={input}
              placeholder="مثال: إرسال صور الوحدة"
            />
          </div>
          <div>
            <label className={label}>موعد المتابعة {req}</label>
            <input
              type="date"
              required
              dir="ltr"
              min={value.date}
              value={value.next_date}
              onChange={(e) => set("next_date", e.target.value)}
              className={
                input +
                " text-start " +
                (hint?.tone === "block"
                  ? "border-red-400 bg-red-50"
                  : value.next_date
                    ? ""
                    : "border-amber-400 bg-white")
              }
            />
            {hint && (
              <p
                role={hint.tone === "block" ? "alert" : undefined}
                className={
                  "mt-1 text-[11px] " +
                  (hint.tone === "block"
                    ? "font-semibold text-red-700"
                    : hint.tone === "warn"
                      ? "text-amber-800"
                      : "text-gray-500")
                }
              >
                {hint.text}
                {hint.suggest && (
                  <button
                    type="button"
                    onClick={() => set("next_date", hint.suggest as string)}
                    className="ms-1 rounded border border-red-300 bg-white px-1.5 py-0.5 font-semibold text-red-700 hover:bg-red-50"
                  >
                    أقرب يوم متاح: {arDayName(hint.suggest)}{" "}
                    <span dir="ltr">{hint.suggest}</span>
                  </button>
                )}
              </p>
            )}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-amber-800">
          إلزامي — لا يُحفظ التواصل بدون موعد متابعة، ويُحدَّث به تاريخ متابعة
          العميل تلقائياً فيصلك تذكير عند حلوله. لا متابعة يوم الجمعة، ولكل
          يوم حدّ أعلى من المتابعات.
        </p>
      </div>
      )}
    </div>
  );
}
