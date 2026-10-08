"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Task,
  TASK_PRIORITY_BORDER,
  TASK_PRIORITY_COLORS,
  TASK_STATUS_COLORS,
  dayLabel,
  isOpenTask,
  shortTime,
  taskOrigin,
} from "@/lib/types";
import { friendlyTaskError } from "@/lib/tasks";

// ============================================================
// بطاقة مهمة واحدة.
//
// أهم ما فيها للموظف: العنوان، **من طلبها**، الخطوة القادمة،
// وموعد المتابعة — ثم زر واحد لتغيير الحالة بضغطة.
// ============================================================
export default function TaskCard({
  task,
  myUserId,
  todayISO,
  showAssignee = false,
  compact = false,
  canDeleteAny = false,
}: {
  task: Task;
  myUserId: string;
  todayISO: string;
  showAssignee?: boolean;  // للمدير: لمن أُسندت المهمة
  compact?: boolean;       // نسخة مختصرة لبطاقة لوحة التحكم
  canDeleteAny?: boolean;  // المدير يقدر يحذف أي مهمة
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const late = isOpenTask(task.status) && task.due_date != null && task.due_date < todayISO;
  const canDelete = (task.created_by === myUserId && (task.task_source ?? "manual") === "manual") || canDeleteAny;

  // عبر task_set_status (191): الموافقة والتبعية والصلاحية تُفحص في القاعدة
  async function setStatus(status: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("task_set_status", {
      p_id: task.id, p_status: status, p_reason: null, p_version: task.version ?? null,
    });
    setBusy(false);
    if (error) {
      console.error(error);
      setError(friendlyTaskError(error));
      return;
    }
    if ((data as { result?: string } | null)?.result === "approval_requested") {
      setError("أُرسلت للموافقة.");
    }
    router.refresh();
  }

  async function remove() {
    if (!confirm("حذف هذه المهمة نهائياً؟")) return;
    setBusy(true);
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    setBusy(false);
    if (error) {
      console.error(error);
      setError(friendlyTaskError(error));
      return;
    }
    router.refresh();
  }

  const done = task.status === "منجزة";

  // مهمة «استمارة فشل البيع» (175): إنجازها هو ملء الاستمارة لا الزرّ —
  // القاعدة ترفض «تمّت» قبلها، فلا نعرضه ونقود إلى الاستمارة نفسها.
  const lostForm =
    task.analysis_lost_sale_id && task.opportunity_id
      ? `/dashboard/crm/opportunities/${task.opportunity_id}?tab=lost&analyse=${task.analysis_lost_sale_id}`
      : null;
  const formPending = lostForm !== null && isOpenTask(task.status);

  return (
    <div
      className={`rounded-2xl border border-gray-200 border-s-4 bg-white p-4 shadow-sm transition ${
        TASK_PRIORITY_BORDER[task.priority] ?? "border-s-gray-300"
      } ${done ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-3">
        {/* زر الإنجاز السريع */}
        <button
          onClick={() => setStatus(done ? "جديدة" : "منجزة")}
          disabled={busy || formPending}
          title={formPending ? "تُنجَز وحدها عند حفظ استمارة فشل البيع" : done ? "إرجاعها غير منجزة" : "تعليمها منجزة"}
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition disabled:cursor-not-allowed ${
            done
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-gray-300 text-transparent hover:border-brand-500 hover:text-brand-500"
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">check</span>
        </button>

        <div className="min-w-0 flex-1">
          {/* العنوان */}
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`font-semibold text-gray-800 ${done ? "line-through" : ""}`}>
              <Link href={`/dashboard/tasks/${task.id}`} className="hover:text-brand-700">{task.title}</Link>
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                TASK_PRIORITY_COLORS[task.priority] ?? "bg-gray-100 text-gray-600"
              }`}
            >
              {task.priority}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                TASK_STATUS_COLORS[task.status] ?? "bg-gray-100 text-gray-600"
              }`}
            >
              {task.status}
            </span>
          </div>

          {/* من طلبها + لمن أُسندت */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px] text-gray-400">
                person
              </span>
              {taskOrigin(task, myUserId)}
            </span>

            {showAssignee && (
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px] text-gray-400">
                  assignment_ind
                </span>
                المسؤول: {task.assigned_to_name ?? "—"}
              </span>
            )}

            <span
              className={`flex items-center gap-1 ${late ? "font-bold text-red-600" : ""}`}
            >
              <span className="material-symbols-outlined text-[15px] text-gray-400">
                event
              </span>
              {dayLabel(task.due_date, todayISO)}
              {task.due_time ? ` · ${shortTime(task.due_time)}` : ""}
            </span>
          </div>

          {/* التفاصيل */}
          {!compact && task.description && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">
              {task.description}
            </p>
          )}

          {/* الخطوة القادمة والمتابعة */}
          {(task.next_step || task.follow_up_date) && (
            <div className="mt-2.5 rounded-xl bg-brand-50/70 px-3 py-2 text-sm">
              {task.next_step && (
                <p className="flex items-start gap-1.5 text-brand-900">
                  <span className="material-symbols-outlined text-[16px] text-brand-600">
                    arrow_circle_left
                  </span>
                  <span>
                    <b>الخطوة القادمة:</b> {task.next_step}
                  </span>
                </p>
              )}
              {task.follow_up_date && (
                <p className="mt-1 flex items-center gap-1.5 text-brand-800">
                  <span className="material-symbols-outlined text-[16px] text-brand-600">
                    event_repeat
                  </span>
                  <span>
                    <b>موعد المتابعة:</b> {dayLabel(task.follow_up_date, todayISO)}
                    {task.follow_up_date !== todayISO ? ` (${task.follow_up_date})` : ""}
                  </span>
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
              {error}
            </p>
          )}

          {/* الاستمارة — في النسخة المختصرة أيضاً: هي المهمة كلها */}
          {formPending && lostForm && (
            <Link
              href={lostForm}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-800"
            >
              <span className="material-symbols-outlined text-[16px]">heart_broken</span>
              املأ الاستمارة
            </Link>
          )}

          {/* الأزرار */}
          {!compact && (
            <div className="mt-3 flex flex-wrap gap-2">
              {task.status === "جديدة" && (
                <button
                  onClick={() => setStatus("قيد التنفيذ")}
                  disabled={busy}
                  className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                >
                  بدء التنفيذ
                </button>
              )}
              {isOpenTask(task.status) && !formPending && (
                <button
                  onClick={() => setStatus("منجزة")}
                  disabled={busy}
                  className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                >
                  تمّت
                </button>
              )}
              {task.client_id && (
                <Link
                  href={`/dashboard/clients/${task.client_id}`}
                  className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-100"
                >
                  ملف العميل
                </Link>
              )}
              <Link
                href={`/dashboard/tasks/${task.id}/edit`}
                className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-100"
              >
                تعديل
              </Link>
              {canDelete && (
                <button
                  onClick={remove}
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                >
                  حذف
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
