"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Attendance, formatTime } from "@/lib/types";

// تسجيل البصمة: حضور/انصراف اليوم
export default function CheckInOut({
  employeeId,
  todayRecord,
}: {
  employeeId: string;
  todayRecord: Attendance | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  async function checkIn() {
    setBusy(true);
    const { error } = await supabase.from("attendance").insert({
      employee_id: employeeId,
      work_date: today,
      check_in: new Date().toISOString(),
    });
    setBusy(false);
    if (error) {
      alert("تعذّر التسجيل: " + error.message);
      return;
    }
    router.refresh();
  }

  async function checkOut() {
    if (!todayRecord) return;
    setBusy(true);
    const { error } = await supabase
      .from("attendance")
      .update({ check_out: new Date().toISOString() })
      .eq("id", todayRecord.id);
    setBusy(false);
    if (error) {
      alert("تعذّر التسجيل: " + error.message);
      return;
    }
    router.refresh();
  }

  const hasCheckIn = Boolean(todayRecord?.check_in);
  const hasCheckOut = Boolean(todayRecord?.check_out);

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <h3 className="mb-1 text-lg font-semibold text-gray-800">👆 تسجيل البصمة</h3>
      <p className="mb-4 text-sm text-gray-500">
        {new Date().toLocaleDateString("ar")}
      </p>

      <div className="flex flex-wrap items-center gap-4">
        {!hasCheckIn && (
          <button
            onClick={checkIn}
            disabled={busy}
            className="rounded-lg bg-green-600 px-6 py-3 font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
          >
            تسجيل حضور
          </button>
        )}

        {hasCheckIn && !hasCheckOut && (
          <button
            onClick={checkOut}
            disabled={busy}
            className="rounded-lg bg-red-600 px-6 py-3 font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            تسجيل انصراف
          </button>
        )}

        <div className="text-sm text-gray-600">
          <div>
            الحضور:{" "}
            <b className="text-gray-800" dir="ltr">
              {formatTime(todayRecord?.check_in ?? null)}
            </b>
          </div>
          <div>
            الانصراف:{" "}
            <b className="text-gray-800" dir="ltr">
              {formatTime(todayRecord?.check_out ?? null)}
            </b>
          </div>
        </div>

        {hasCheckIn && hasCheckOut && (
          <span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-700">
            ✓ اكتمل تسجيل اليوم
          </span>
        )}
      </div>
    </div>
  );
}
