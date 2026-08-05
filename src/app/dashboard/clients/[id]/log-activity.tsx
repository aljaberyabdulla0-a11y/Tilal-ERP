"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ACTIVITY_DIRECTIONS,
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  activityMeta,
} from "@/lib/types";
import { baghdadDate, baghdadStamp, baghdadTime } from "@/lib/time";

// ============================================================
// تسجيل تواصل مع العميل.
// الاستخدام المقصود: اضغط نوع التواصل (مكالمة/واتساب/اجتماع...) فيفتح
// نموذج مختصر مملوء بوقت الآن، تكتب ملخّصاً وتحفظ في ثوانٍ.
// ============================================================
export default function LogActivity({ clientId }: { clientId: string }) {
  const router = useRouter();
  const supabase = createClient();

  const [type, setType] = useState<string | null>(null);
  const [date, setDate] = useState(baghdadDate());
  const [time, setTime] = useState(baghdadTime(new Date()));
  const [direction, setDirection] = useState<string>("صادر");
  const [outcome, setOutcome] = useState<string>("تم التواصل");
  const [duration, setDuration] = useState("");
  const [summary, setSummary] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextDate, setNextDate] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(selected: string) {
    setError(null);
    setType(selected);
    setDate(baghdadDate());
    setTime(baghdadTime(new Date()));
    setDirection("صادر");
    setOutcome("تم التواصل");
    setDuration("");
    setSummary("");
    setNextAction("");
    setNextDate("");
  }

  function close() {
    setType(null);
    setError(null);
  }

  async function save() {
    if (!type) return;
    setError(null);

    const occurredAt = baghdadStamp(date, time);
    if (!occurredAt) {
      setError("تاريخ أو وقت التواصل غير صحيح.");
      return;
    }
    if (new Date(occurredAt).getTime() > Date.now() + 60000) {
      setError("لا يمكن تسجيل تواصل في المستقبل.");
      return;
    }

    const meta = activityMeta(type);
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("client_activities").insert({
      client_id: clientId,
      created_by: user?.id ?? null,
      activity_type: type,
      direction: meta.hasDirection ? direction : null,
      outcome: type === "ملاحظة" ? null : outcome,
      occurred_at: occurredAt,
      duration_min: meta.hasDuration && duration ? Number(duration) : null,
      summary: summary.trim() || null,
      next_action: nextAction.trim() || null,
      next_action_date: nextDate || null,
    });
    setSaving(false);

    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }
    close();
    router.refresh();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const label = "mb-1 block text-xs font-medium text-gray-600";
  const meta = type ? activityMeta(type) : null;

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <h3 className="mb-3 font-semibold text-gray-800">تسجيل تواصل</h3>

      {/* أزرار سريعة */}
      <div className="flex flex-wrap gap-2">
        {ACTIVITY_TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => open(t.key)}
            className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
              type === t.key
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
            {t.key}
          </button>
        ))}
      </div>

      {/* النموذج المختصر */}
      {type && meta && (
        <div className="mt-4 space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center gap-2">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${meta.color}`}
            >
              <span className="material-symbols-outlined text-[18px]">{meta.icon}</span>
            </span>
            <span className="font-semibold text-gray-800">{type}</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={label}>التاريخ</label>
              <input
                type="date"
                dir="ltr"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={input + " text-left"}
              />
            </div>
            <div>
              <label className={label}>الوقت</label>
              <input
                type="time"
                dir="ltr"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={input + " text-left"}
              />
            </div>

            {meta.hasDirection && (
              <div>
                <label className={label}>الاتجاه</label>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
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
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className={input + " text-left"}
                  placeholder="مثال: 10"
                />
              </div>
            )}

            {type !== "ملاحظة" && (
              <div>
                <label className={label}>النتيجة</label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
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
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className={input}
              placeholder="مثال: سأل عن شقة ثلاث غرف في المنصور، وسعرها ضمن ميزانيته."
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>الخطوة القادمة</label>
              <input
                type="text"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                className={input}
                placeholder="مثال: إرسال صور الوحدة"
              />
            </div>
            <div>
              <label className={label}>موعد المتابعة</label>
              <input
                type="date"
                dir="ltr"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
                className={input + " text-left"}
              />
              <p className="mt-1 text-[11px] text-gray-400">
                يُحدَّث تاريخ متابعة العميل تلقائياً.
              </p>
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "جاري الحفظ..." : "حفظ التواصل"}
            </button>
            <button
              onClick={close}
              disabled={saving}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
