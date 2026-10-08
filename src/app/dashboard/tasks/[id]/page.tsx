import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { baghdadDate } from "@/lib/time";
import { getAssignablePeople, getTaskDetail } from "@/lib/tasks-server";
import { activitySentence, formatMinutes, timeAgo } from "@/lib/tasks";
import { dayLabel, shortTime, taskOrigin } from "@/lib/types";
import { FlagChip, LabelChips, PriorityBadge, StatusBadge, StepBadge, TypeIcon } from "@/components/tasks/badges";
import DetailActions from "@/components/tasks/detail/detail-actions";
import ApprovalPanel from "@/components/tasks/detail/approval-panel";
import ChecklistPanel from "@/components/tasks/detail/checklist-panel";
import CommentsPanel from "@/components/tasks/detail/comments-panel";
import AttachmentsPanel from "@/components/tasks/detail/attachments-panel";
import RelationsPanel from "@/components/tasks/detail/relations-panel";

// ============================================================
// صفحة المهمة — كل ما حولها في مكان واحد.
//
//   الرأس    العنوان، الحالة، الأولوية، المسؤول، القسم، الموعد
//   الوسط    التفاصيل، الموافقة، الأفعال، قائمة التحقق، الفرعية
//            والتبعيات والمتابعون، التعليقات، المرفقات، السجلّ
//   الجانب   من طلبها ومتى، المصدر، الكيان المرتبط، المشروع، الحملة،
//            الوقت والموعد النهائي، الوسوم
//
// task_detail (191) INVOKER: من لا يرى المهمة يرى «غير موجودة».
// ============================================================
export default async function TaskDetailPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const [user, detail, people] = await Promise.all([getCurrentUser(), getTaskDetail(params.id), getAssignablePeople()]);
  if (!detail) notFound();

  const t = detail.task;
  const today = baghdadDate();
  const myUserId = user?.id ?? "";

  const side = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="flex justify-between gap-3 border-b border-line py-2 text-sm last:border-0">
        <dt className="shrink-0 text-gray-500">{label}</dt>
        <dd className="min-w-0 text-end font-medium text-ink">{value}</dd>
      </div>
    ) : null;

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-gray-500" aria-label="مسار التنقّل">
        <Link href="/dashboard/tasks" className="hover:text-brand-700">المهام</Link>
        {detail.parent && (
          <>
            <span aria-hidden="true">‹</span>
            <Link href={`/dashboard/tasks/${detail.parent.id}`} className="hover:text-brand-700">{detail.parent.title}</Link>
          </>
        )}
      </nav>

      <header className="mb-4">
        <div className="flex flex-wrap items-start gap-3">
          <TypeIcon icon={t.type_icon} name={t.type_name} />
          <h1 className="min-w-0 flex-1 text-xl font-bold text-ink sm:text-2xl">{t.title}</h1>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <StatusBadge status={t.status} />
          <PriorityBadge priority={t.priority} />
          <StepBadge name={t.step_name} color={t.step_color} />
          {t.is_late && <FlagChip tone="red" icon="warning">متأخرة</FlagChip>}
          {t.is_waiting && <FlagChip tone="amber" icon="pause_circle">بانتظار</FlagChip>}
          {t.sla_breached && <FlagChip tone="red" icon="timer_off">تجاوز SLA</FlagChip>}
          {t.archived_at && <FlagChip tone="gray" icon="archive">مؤرشفة</FlagChip>}
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-gray-400">assignment_ind</span>
            {t.assigned_to_name}
          </span>
          {t.department_name && (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-gray-400">apartment</span>
              {t.department_name}
            </span>
          )}
          <span className={`inline-flex items-center gap-1 ${t.is_late ? "font-bold text-red-600" : ""}`}>
            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-gray-400">event</span>
            {dayLabel(t.due_date, today)}{t.due_date && t.due_date !== today ? ` (${t.due_date})` : ""}
            {t.due_time ? ` · ${shortTime(t.due_time)}` : ""}
          </span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <DetailActions detail={detail} people={people} />

          {(t.description || t.next_step || t.follow_up_date || t.blocked_reason || t.cancellation_reason) && (
            <section className="dash-card space-y-3 p-4" aria-label="التفاصيل">
              {t.description && <p className="whitespace-pre-wrap text-sm leading-7 text-ink">{t.description}</p>}
              {(t.next_step || t.follow_up_date) && (
                <div className="rounded-xl bg-brand-50/70 px-3 py-2 text-sm">
                  {t.next_step && <p className="text-brand-900"><b>الخطوة القادمة:</b> {t.next_step}</p>}
                  {t.follow_up_date && <p className="mt-1 text-brand-800"><b>موعد المتابعة:</b> {dayLabel(t.follow_up_date, today)} <span dir="ltr">({t.follow_up_date})</span></p>}
                </div>
              )}
              {t.blocked_reason && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900"><b>متوقّفة:</b> {t.blocked_reason}</p>}
              {t.cancellation_reason && <p className="rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-700"><b>سبب الإلغاء:</b> {t.cancellation_reason}</p>}
            </section>
          )}

          <ApprovalPanel detail={detail} />

          <ChecklistPanel taskId={t.id} items={detail.checklist} canEdit={detail.permissions.can_edit} />

          <RelationsPanel detail={detail} people={people} />

          <CommentsPanel taskId={t.id} comments={detail.comments} people={people} />

          <AttachmentsPanel taskId={t.id} attachments={detail.attachments}
            canEdit={detail.permissions.can_edit} canUpload />

          <section className="dash-card p-4" aria-label="سجلّ النشاط">
            <h2 className="mb-3 flex items-center gap-2 font-bold text-ink">
              <span aria-hidden="true" className="material-symbols-outlined">history</span>السجلّ
            </h2>
            <ol className="relative space-y-3 border-s-2 border-line ps-4">
              {detail.activity.map((a) => (
                <li key={a.id} className="relative">
                  <span aria-hidden="true" className="absolute -start-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-400" />
                  <p className="text-sm text-ink">{activitySentence(a)}</p>
                  <p className="text-[11px] text-gray-400" title={a.at}>{timeAgo(a.at)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="dash-card p-4" aria-label="معلومات المهمة">
            <dl>
              {side("طلبها", taskOrigin(t, myUserId))}
              {side("أُنشئت", <span title={t.created_at}>{baghdadDate(t.created_at)} · {timeAgo(t.created_at)}</span>)}
              {side("المصدر", t.source_name)}
              {side("النوع", t.type_name)}
              {side(t.entity_type_name ?? "مرتبطة بـ", t.entity_label && (t.entity_url
                ? <Link href={t.entity_url} className="text-brand-700 hover:underline">{t.entity_label}</Link> : t.entity_label))}
              {t.entity_type !== "client" && side("العميل", t.client_id && t.client_name && (
                <Link href={`/dashboard/clients/${t.client_id}`} className="text-brand-700 hover:underline">{t.client_name}</Link>))}
              {t.entity_type !== "opportunity" && side("الفرصة", t.opportunity_id && t.opportunity_title && (
                <Link href={`/dashboard/crm/opportunities/${t.opportunity_id}`} className="text-brand-700 hover:underline">{t.opportunity_title}</Link>))}
              {side("المشروع", t.project_id && t.project_name && (
                <Link href={`/dashboard/tasks?view=list&project=${t.project_id}`} className="text-brand-700 hover:underline">{t.project_name}</Link>))}
              {side("الحملة", t.campaign_id && t.campaign_name && (
                <Link href={`/dashboard/marketing/campaigns/${t.campaign_id}`} className="text-brand-700 hover:underline">{t.campaign_name}</Link>))}
              {side("بدأت", t.started_at && baghdadDate(t.started_at))}
              {side("أُنجزت", t.completed_at && `${baghdadDate(t.completed_at)}${t.completed_by_name ? ` — ${t.completed_by_name}` : ""}`)}
              {side("أُلغيت", t.cancelled_at && `${baghdadDate(t.cancelled_at)}${t.cancelled_by_name ? ` — ${t.cancelled_by_name}` : ""}`)}
              {side("التقدير", formatMinutes(t.estimated_minutes))}
              {side("الفعلي", formatMinutes(t.actual_minutes))}
              {side("الموعد النهائي", t.deadline_at && <span dir="ltr">{baghdadDate(t.deadline_at)}</span>)}
            </dl>
            {t.labels.length > 0 && <div className="mt-3"><LabelChips labels={t.labels} /></div>}
          </section>
        </aside>
      </div>
    </main>
  );
}
