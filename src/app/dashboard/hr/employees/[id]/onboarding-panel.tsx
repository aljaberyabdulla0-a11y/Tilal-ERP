"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { OnboardingTask } from "@/lib/recruitment";
import OnboardingTaskButton from "@/components/onboarding-task-button";

// تهيئة الموظف (sql/151) في ملفه: المهام وحالتها، وزرّ «بدء التهيئة»
// لموظفٍ قديم لم تُولَّد له (الجديد تُولَّد له تلقائياً).
export default function OnboardingPanel({
  employeeId,
  tasks,
  canEdit,
}: {
  employeeId: string;
  tasks: OnboardingTask[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("start_onboarding", { p_employee: employeeId });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  const done = tasks.filter((t) => t.status !== "معلّقة").length;

  if (tasks.length === 0) {
    if (!canEdit) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-white p-5 shadow-sm">
        <span className="text-sm text-gray-500">لا قائمة تهيئة لهذا الموظف.</span>
        <button disabled={busy} onClick={start} className="rounded-lg border px-3 py-1.5 text-sm text-brand-700 hover:bg-gray-50 disabled:opacity-50">
          بدء التهيئة
        </button>
        {err && <p className="w-full text-xs text-red-600">{err}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">التهيئة</h3>
        <span className="text-sm text-gray-500">{done}/{tasks.length} منجزة</span>
      </div>
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full bg-green-500" style={{ width: `${Math.round((done / tasks.length) * 100)}%` }} />
      </div>
      <ul className="divide-y divide-gray-100">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className={t.status === "معلّقة" ? "text-gray-800" : "text-gray-400 line-through"}>{t.title}</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{t.owner_role}</span>
            {t.due_date && t.status === "معلّقة" && <span className="text-xs text-gray-400" dir="ltr">{t.due_date}</span>}
            {t.status !== "معلّقة" && <span className="text-[11px] text-gray-400">{t.completed_by_name}{t.note ? ` · ${t.note}` : ""}</span>}
            {canEdit && <OnboardingTaskButton id={t.id} status={t.status} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
