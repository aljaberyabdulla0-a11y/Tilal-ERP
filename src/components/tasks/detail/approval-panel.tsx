"use client";

import { useState } from "react";
import type { TaskDetail } from "@/lib/types";
import { useTaskActions } from "../use-task-actions";

// ============================================================
// الموافقة: الحالة لمن يرى المهمة، والقرار لمن يملكه (can_approve).
// الرفض يطلب سبباً — كي يعرف المسؤول ما يصلحه.
// ============================================================
export default function ApprovalPanel({ detail }: { detail: TaskDetail }) {
  const t = detail.task;
  const a = useTaskActions();
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  if (!t.requires_approval) return null;

  const tone =
    t.approval_status === "معتمدة" ? "border-emerald-200 bg-emerald-50"
    : t.approval_status === "مرفوضة" ? "border-red-200 bg-red-50"
    : t.approval_status === "بانتظار الموافقة" ? "border-purple-200 bg-purple-50"
    : "border-line bg-surface-subtle";

  return (
    <section className={`rounded-2xl border p-4 ${tone}`} aria-label="الموافقة">
      <h2 className="mb-1 flex items-center gap-2 font-bold text-ink">
        <span aria-hidden="true" className="material-symbols-outlined">verified</span>
        الموافقة
      </h2>
      <p className="text-sm text-gray-700">
        {t.approval_status === "بانتظار الموافقة" && <>بانتظار موافقة <b>{t.approver_name ?? "المعتمِد"}</b></>}
        {t.approval_status === "معتمدة" && <>اعتمدها <b>{t.approved_by_name}</b></>}
        {t.approval_status === "مرفوضة" && <>رفضها <b>{t.approved_by_name}</b>{t.rejection_reason ? ` — ${t.rejection_reason}` : ""}</>}
        {!t.approval_status && <>تحتاج موافقة {t.approver_name ? <b>{t.approver_name}</b> : "من طلبها أو مدير القسم"} قبل إنجازها.</>}
      </p>

      {detail.permissions.can_approve && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => a.decide(t.id, true)} disabled={a.busy}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            اعتماد
          </button>
          {!rejecting ? (
            <button type="button" onClick={() => setRejecting(true)} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700">
              رفض
            </button>
          ) : (
            <>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ما الذي يجب إصلاحه؟" maxLength={500}
                className="min-w-0 flex-1 rounded-lg border border-red-200 px-3 py-2 text-sm" autoFocus />
              <button type="button" onClick={() => a.decide(t.id, false, reason)} disabled={a.busy || !reason.trim()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">تأكيد الرفض</button>
            </>
          )}
        </div>
      )}
      {a.error && <p role="alert" className="mt-2 text-sm text-red-700">{a.error}</p>}
    </section>
  );
}
