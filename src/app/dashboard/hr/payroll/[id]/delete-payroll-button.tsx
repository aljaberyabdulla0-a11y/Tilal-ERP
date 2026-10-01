"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// حذف الكشف — للمدير. يمرّ بـ delete_payroll لا بالحذف المباشر:
// الدالة تسحب القيد من الدفاتر وتُعيد العمولات والاستقطاعات وأقساط
// السلفة حرّةً لكشفٍ قادم (sql/106).
export default function DeletePayrollButton({
  id,
  employeeName,
  period,
  approved,
}: {
  id: string;
  employeeName: string;
  period: string;
  approved: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const msg =
      `حذف كشف ${employeeName} لشهر ${period} نهائياً؟` +
      (approved ? "\nسيُسحب قيده من الدفاتر." : "") +
      "\nالعمولات والاستقطاعات وأقساط السلفة تعود متاحةً لكشفٍ جديد.";
    if (!window.confirm(msg)) return;

    setDeleting(true);
    const { error } = await supabase.rpc("delete_payroll", { p_id: id });
    setDeleting(false);
    if (error) {
      alert("تعذّر الحذف: " + error.message);
      return;
    }
    router.push("/dashboard/hr/payroll");
    router.refresh();
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="flex items-center gap-1.5 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
    >
      <span className="material-symbols-outlined text-[18px]">delete</span>
      {deleting ? "جارٍ…" : "حذف الكشف"}
    </button>
  );
}
