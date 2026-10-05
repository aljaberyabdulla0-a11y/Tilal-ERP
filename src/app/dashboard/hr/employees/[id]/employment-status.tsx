"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EMPLOYMENT_STATUS_STYLE } from "@/lib/types";

// الحالة الوظيفية (sql/148): شارة + الانتقالات المسموحة من جدولها.
// الخروج (مستقيل/منتهية خدمته) لا يُختار لموظف نشط — يمرّ بـ«إنهاء الخدمة».
export default function EmploymentStatus({
  employeeId,
  current,
  transitions,
  canEdit,
}: {
  employeeId: string;
  current: string;
  transitions: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function change(to: string) {
    if (!to || !confirm(`تغيير الحالة الوظيفية إلى «${to}»؟`)) return;
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from("employees").update({ employment_status: to }).eq("id", employeeId);
    setSaving(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${EMPLOYMENT_STATUS_STYLE[current] ?? "bg-gray-100"}`}>
        {current}
      </span>
      {canEdit && transitions.length > 0 && (
        <select
          value=""
          disabled={saving}
          onChange={(e) => change(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
        >
          <option value="">تغيير إلى…</option>
          {transitions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
