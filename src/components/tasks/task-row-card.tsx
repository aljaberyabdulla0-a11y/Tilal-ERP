"use client";

import { useState } from "react";
import Link from "next/link";
import { isOpenTask, taskOrigin, type TaskRow } from "@/lib/types";
import { progressOf } from "@/lib/tasks";
import LogActivity from "@/app/dashboard/clients/[id]/log-activity";
import { DueLabel, FlagChip, LabelChips, MiniProgress, PriorityBadge, StatusBadge, StepBadge, TypeIcon } from "./badges";
import { useTaskActions } from "./use-task-actions";

// ============================================================
// بطاقة مهمة في القوائم (عملي، القائمة، المساحات).
//
// أهم ما فيها: العنوان، الموعد، من طلبها، الخطوة القادمة، وما يرتبط
// بها — ثم فعلٌ واحد بنقرة: «ابدأ» أو «تمّت». التفاصيل في صفحة المهمة.
//
// variant="sales": أزرار CRM — اتصل، سجّل نتيجة الاتصال، أجّل المتابعة،
// افتح العميل/الفرصة، مهمة جديدة على العميل.
// ============================================================
export default function TaskRowCard({
  task,
  todayISO,
  myUserId,
  showAssignee = false,
  variant = "default",
  selectable = false,
  selected = false,
  onSelect,
}: {
  task: TaskRow;
  todayISO: string;
  myUserId: string;
  showAssignee?: boolean;
  variant?: "default" | "sales" | "compact";
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string, on: boolean) => void;
}) {
  const a = useTaskActions();
  const [logOpen, setLogOpen] = useState(false);
  const [resched, setResched] = useState(false);
  const [newDate, setNewDate] = useState(task.follow_up_date ?? task.due_date ?? todayISO);

  const open = isOpenTask(task.status);
  const done = task.status === "منجزة";
  // مهمة الاستمارة (175): إنجازها بملء الاستمارة لا بالزرّ
  const lostForm =
    task.analysis_lost_sale_id && task.opportunity_id
      ? `/dashboard/crm/opportunities/${task.opportunity_id}?tab=lost&analyse=${task.analysis_lost_sale_id}`
      : null;
  const formPending = lostForm !== null && open;
  const pendingApproval = task.approval_status === "بانتظار الموافقة";
  const prog = progressOf(task);

  async function complete() {
    const r = await a.setStatus(task.id, done ? "جديدة" : "منجزة", null, task.version);
    if (r?.result === "approval_requested") a.setError(null);
  }

  async function reschedule() {
    if (!newDate) return;
    const r = await a.save({ id: task.id, version: task.version, due_date: newDate, follow_up_date: newDate });
    if (r) setResched(false);
  }

  const border =
    task.priority === "عاجلة" ? "border-s-red-500" : task.priority === "متوسطة" ? "border-s-amber-500" : "border-s-gray-300";

  return (
    <article
      className={`rounded-2xl border border-line border-s-4 bg-surface p-3.5 shadow-card transition sm:p-4 ${border} ${
        done ? "opacity-70" : ""
      } ${selected ? "ring-2 ring-brand-400" : ""}`}
    >
      <div className="flex items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect?.(task.id, e.target.checked)}
            aria-label={`تحديد «${task.title}»`}
            className="mt-1.5 h-4 w-4 shrink-0 rounded border-gray-300 text-brand-600"
          />
        )}

        {/* الإنجاز بنقرة */}
        <button
          type="button"
          onClick={complete}
          disabled={a.busy || formPending || pendingApproval || task.status === "ملغاة"}
          title={
            formPending ? "تُنجَز وحدها عند حفظ استمارة فشل البيع"
            : pendingApproval ? "بانتظار الموافقة"
            : done ? "إرجاعها غير منجزة"
            : task.requires_approval && task.approval_status !== "معتمدة" ? "إرسالها للموافقة"
            : "تعليمها منجزة"
          }
          aria-label={done ? "إرجاع المهمة" : "إنجاز المهمة"}
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition disabled:cursor-not-allowed disabled:opacity-50 ${
            done ? "border-emerald-500 bg-emerald-500 text-white" : "border-gray-300 text-transparent hover:border-brand-500 hover:text-brand-500"
          }`}
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">check</span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {variant !== "compact" && <TypeIcon icon={task.type_icon} name={task.type_name} />}
            <Link
              href={`/dashboard/tasks/${task.id}`}
              className={`dash-focus rounded font-semibold text-ink hover:text-brand-700 ${done ? "line-through" : ""}`}
            >
              {task.title}
            </Link>
            <PriorityBadge priority={task.priority} />
            {task.status !== "جديدة" && <StatusBadge status={task.status} />}
            <StepBadge name={task.step_name} color={task.step_color} />
            {pendingApproval && <FlagChip tone="purple" icon="hourglass_top">بانتظار الموافقة</FlagChip>}
            {task.approval_status === "مرفوضة" && <FlagChip tone="red" icon="block">مرفوضة</FlagChip>}
            {task.is_waiting && !pendingApproval && <FlagChip tone="amber" icon="pause_circle">بانتظار</FlagChip>}
            {task.is_due_soon && !task.is_late && <FlagChip tone="blue" icon="alarm">قريبة</FlagChip>}
            {task.sla_breached && <FlagChip tone="red" icon="timer_off">تجاوز SLA</FlagChip>}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
            <DueLabel date={task.due_date} time={task.due_time} todayISO={todayISO} late={task.is_late} />
            {showAssignee ? (
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-gray-400">assignment_ind</span>
                {task.assigned_to_name ?? "—"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-gray-400">person</span>
                {taskOrigin(task, myUserId)}
              </span>
            )}
            {task.department_name && variant !== "compact" && (
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-gray-400">apartment</span>
                {task.department_name}
              </span>
            )}
            {(task.client_name || task.entity_label) && (
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-gray-400">link</span>
                {task.client_name ?? task.entity_label}
                {task.opportunity_title ? ` · ${task.opportunity_title}` : ""}
              </span>
            )}
            {task.project_name && variant !== "compact" && (
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-gray-400">foundation</span>
                {task.project_name}
              </span>
            )}
            <MiniProgress done={prog.done} total={prog.total} />
            {task.comments_count > 0 && (
              <span className="inline-flex items-center gap-0.5" title="تعليقات">
                <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-gray-400">chat_bubble</span>
                <span dir="ltr">{task.comments_count}</span>
              </span>
            )}
            {task.attachments_count > 0 && (
              <span className="inline-flex items-center gap-0.5" title="مرفقات">
                <span aria-hidden="true" className="material-symbols-outlined text-[14px] text-gray-400">attach_file</span>
                <span dir="ltr">{task.attachments_count}</span>
              </span>
            )}
          </div>

          {variant !== "compact" && <div className="mt-1"><LabelChips labels={task.labels} /></div>}

          {variant !== "compact" && (task.next_step || task.follow_up_date || task.blocked_reason) && (
            <div className="mt-2 space-y-0.5 rounded-xl bg-brand-50/70 px-3 py-1.5 text-[13px]">
              {task.next_step && (
                <p className="text-brand-900"><b>الخطوة القادمة:</b> {task.next_step}</p>
              )}
              {task.follow_up_date && (
                <p className="text-brand-800"><b>المتابعة:</b> <span dir="ltr">{task.follow_up_date}</span></p>
              )}
              {task.blocked_reason && <p className="text-amber-800"><b>متوقّفة:</b> {task.blocked_reason}</p>}
            </div>
          )}

          {a.error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">{a.error}</p>}

          {formPending && lostForm && (
            <Link href={lostForm} className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">heart_broken</span>
              املأ الاستمارة
            </Link>
          )}

          {variant !== "compact" && open && !formPending && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {task.status === "جديدة" && (
                <button type="button" onClick={() => a.setStatus(task.id, "قيد التنفيذ", null, task.version)} disabled={a.busy}
                  className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                  ابدأ
                </button>
              )}
              {!pendingApproval && (
                <button type="button" onClick={complete} disabled={a.busy}
                  className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                  {task.requires_approval && task.approval_status !== "معتمدة" ? "أرسل للموافقة" : "تمّت"}
                </button>
              )}

              {variant === "sales" && (
                <>
                  {task.client_phone && (
                    <a href={`tel:${task.client_phone}`} className="rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100">
                      <span aria-hidden="true" className="material-symbols-outlined me-0.5 align-[-3px] text-[15px]">call</span>
                      اتصل
                    </a>
                  )}
                  {task.client_id && (
                    <button type="button" onClick={() => setLogOpen((v) => !v)}
                      className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100">
                      سجّل نتيجة الاتصال
                    </button>
                  )}
                  <button type="button" onClick={() => setResched((v) => !v)}
                    className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100">
                    أجّل المتابعة
                  </button>
                  {task.client_id && (
                    <Link href={`/dashboard/tasks/new?entity_type=client&entity_id=${task.client_id}`}
                      className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100">
                      مهمة جديدة
                    </Link>
                  )}
                </>
              )}

              {task.client_id && (
                <Link href={`/dashboard/clients/${task.client_id}`} className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100">
                  العميل
                </Link>
              )}
              {task.opportunity_id && (
                <Link href={`/dashboard/crm/opportunities/${task.opportunity_id}`} className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100">
                  الفرصة
                </Link>
              )}
            </div>
          )}

          {resched && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-subtle p-2">
              <label className="text-xs text-gray-600" htmlFor={`rs-${task.id}`}>الموعد الجديد</label>
              <input id={`rs-${task.id}`} type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm" />
              <button type="button" onClick={reschedule} disabled={a.busy}
                className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">حفظ</button>
            </div>
          )}

          {logOpen && task.client_id && (
            <div className="mt-2 rounded-xl border border-line bg-surface-subtle p-2">
              <LogActivity
                clientId={task.client_id}
                opportunities={task.opportunity_id ? [{ id: task.opportunity_id, title: task.opportunity_title ?? "الفرصة" }] : []}
              />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
