"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Attendance } from "@/lib/types";

// تسجيل حضور/انصراف يدوي للموظف (للمدير) — بدون قيد الموقع
export default function ManualStamp({
  employeeId,
  workDate,
  record,
}: {
  employeeId: string;
  workDate: string;
  record: Attendance | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function stamp(kind: "in" | "out") {
    setBusy(true);
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
      alert("تعذّر التسجيل: " + error.message);
      return;
    }
    router.refresh();
  }

  const hasIn = Boolean(record?.check_in);
  const hasOut = Boolean(record?.check_out);

  if (hasIn && hasOut) {
    return <span className="text-xs text-gray-400">مكتمل</span>;
  }

  return (
    <button
      onClick={() => stamp(hasIn ? "out" : "in")}
      disabled={busy}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50 ${
        hasIn ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
      }`}
    >
      {busy ? "..." : hasIn ? "تسجيل انصراف" : "تسجيل حضور"}
    </button>
  );
}
