"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Attendance } from "@/lib/types";

// "2026-08-05" + "09:15" → طابع زمني بالتوقيت المحلي
function toStamp(date: string, time: string): string | null {
  if (!time) return null;
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// طابع زمني → "09:15" بالتوقيت المحلي (لملء حقل الوقت)
function toTimeInput(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ============================================================
// تسجيل/تصحيح بصمة موظف يدوياً (للمدير) — بدون قيد الموقع.
//   • يوم اليوم: زر سريع يسجّل بالوقت الحالي.
//   • أي يوم آخر: محرّر يكتب فيه المدير وقت الحضور والانصراف الفعليين
//     (لو سجّلنا وقت اللحظة على يوم قديم لصارت البيانات غلط).
// ============================================================
export default function ManualStamp({
  employeeId,
  workDate,
  record,
  isToday,
}: {
  employeeId: string;
  workDate: string;
  record: Attendance | null;
  isToday: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [inTime, setInTime] = useState(toTimeInput(record?.check_in));
  const [outTime, setOutTime] = useState(toTimeInput(record?.check_out));
  const [error, setError] = useState<string | null>(null);

  const hasIn = Boolean(record?.check_in);
  const hasOut = Boolean(record?.check_out);

  // تسجيل سريع بالوقت الحالي (اليوم فقط)
  async function quickStamp(kind: "in" | "out") {
    setBusy(true);
    setError(null);
    const now = new Date().toISOString();

    const { error } = record
      ? await supabase
          .from("attendance")
          .update(kind === "in" ? { check_in: now } : { check_out: now })
          .eq("id", record.id)
      : await supabase.from("attendance").insert({
          employee_id: employeeId,
          work_date: workDate,
          check_in: now,
          source: "تسجيل يدوي بواسطة المدير",
        });

    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  // حفظ الأوقات المكتوبة يدوياً
  async function saveTimes() {
    setError(null);
    const checkIn = toStamp(workDate, inTime);
    const checkOut = toStamp(workDate, outTime);

    if (!checkIn && checkOut) {
      setError("اكتب وقت الحضور أولاً.");
      return;
    }
    if (checkIn && checkOut && new Date(checkOut) <= new Date(checkIn)) {
      setError("وقت الانصراف يجب أن يكون بعد الحضور.");
      return;
    }

    setBusy(true);
    const payload = {
      check_in: checkIn,
      check_out: checkOut,
      source: "تسجيل يدوي بواسطة المدير",
    };

    const { error } = record
      ? await supabase.from("attendance").update(payload).eq("id", record.id)
      : await supabase
          .from("attendance")
          .insert({ employee_id: employeeId, work_date: workDate, ...payload });

    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  // حذف سجل خاطئ بالكامل
  async function removeRecord() {
    if (!record) return;
    if (!confirm(`حذف بصمة يوم ${workDate} نهائياً؟`)) return;
    setBusy(true);
    const { error } = await supabase.from("attendance").delete().eq("id", record.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="inline-flex flex-col items-start gap-2 rounded-xl border border-gray-200 bg-white p-3 text-right shadow-sm">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">حضور</label>
          <input
            type="time"
            dir="ltr"
            value={inTime}
            onChange={(e) => setInTime(e.target.value)}
            className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-left text-xs focus:border-brand-500 focus:outline-none"
          />
          <label className="text-xs text-gray-500">انصراف</label>
          <input
            type="time"
            dir="ltr"
            value={outTime}
            onChange={(e) => setOutTime(e.target.value)}
            className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-left text-xs focus:border-brand-500 focus:outline-none"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            onClick={saveTimes}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "..." : "حفظ"}
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setError(null);
              setInTime(toTimeInput(record?.check_in));
              setOutTime(toTimeInput(record?.check_out));
            }}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-100"
          >
            إلغاء
          </button>
          {record && (
            <button
              onClick={removeRecord}
              disabled={busy}
              className="text-xs text-red-600 hover:underline"
            >
              حذف السجل
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {/* الزر السريع يظهر ليوم اليوم فقط */}
      {isToday && !(hasIn && hasOut) && (
        <button
          onClick={() => quickStamp(hasIn ? "out" : "in")}
          disabled={busy}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50 ${
            hasIn ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
          }`}
        >
          {busy ? "..." : hasIn ? "تسجيل انصراف" : "تسجيل حضور"}
        </button>
      )}

      <button
        onClick={() => setEditing(true)}
        disabled={busy}
        title={record ? "تصحيح الأوقات" : "تسجيل يدوي بوقت محدّد"}
        className="whitespace-nowrap rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 transition hover:bg-gray-100"
      >
        {record ? "تصحيح" : "تسجيل يدوي"}
      </button>

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
