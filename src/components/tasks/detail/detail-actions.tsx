"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyTaskError } from "@/lib/tasks";
import { isOpenTask, type AssignablePerson, type TaskDetail } from "@/lib/types";
import { useTaskActions } from "../use-task-actions";

// ============================================================
// شريط أفعال المهمة — كل زرّ يظهر لمن يملكه (permissions من task_detail)،
// والقاعدة تفحص مرة أخرى. الإلغاء يطلب سبباً حيث يلزم، والحذف للمدير
// أو لمنشئ مهمة يدوية فقط.
// ============================================================
export default function DetailActions({ detail, people }: { detail: TaskDetail; people: AssignablePerson[] }) {
  const t = detail.task;
  const perm = detail.permissions;
  const router = useRouter();
  const supabase = createClient();
  const a = useTaskActions();
  const [panel, setPanel] = useState<"" | "cancel" | "reassign" | "block">("");
  const [reason, setReason] = useState("");
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const open = isOpenTask(t.status);
  const lostForm = t.analysis_lost_sale_id && t.opportunity_id && open
    ? `/dashboard/crm/opportunities/${t.opportunity_id}?tab=lost&analyse=${t.analysis_lost_sale_id}` : null;
  const pending = t.approval_status === "بانتظار الموافقة";
  const needsApproval = t.requires_approval && t.approval_status !== "معتمدة";

  async function complete() {
    const r = await a.setStatus(t.id, "منجزة", null, t.version);
    if (r?.result === "approval_requested") setMsg(`أُرسلت للموافقة${r.approver ? ` — ${r.approver}` : ""}.`);
  }
  async function cancel() {
    const r = await a.setStatus(t.id, "ملغاة", reason, t.version);
    if (r) { setPanel(""); setReason(""); }
  }
  async function reassign() {
    if (!assignee) return;
    const r = await a.reassign(t.id, assignee, note);
    if (r) { setPanel(""); setNote(""); }
  }
  async function block() {
    const r = await a.save({ id: t.id, version: t.version, blocked_reason: reason });
    if (r) { setPanel(""); setReason(""); }
  }
  async function duplicate() {
    const id = await a.duplicate(t.id);
    if (id) router.push(`/dashboard/tasks/${id}`);
  }
  async function remove() {
    if (!confirm("حذف هذه المهمة نهائياً؟ الأرشفة تحفظ تاريخها — الحذف لا.")) return;
    const { error } = await supabase.from("tasks").delete().eq("id", t.id);
    if (error) {
      console.error(error);
      return a.setError(friendlyTaskError(error));
    }
    router.push("/dashboard/tasks");
    router.refresh();
  }

  const btn = "inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-50";
  const ghost = `${btn} border border-gray-300 bg-white text-gray-700 hover:border-brand-500`;

  return (
    <div className="dash-card p-3">
      <div className="flex flex-wrap gap-2">
        {lostForm && (
          <Link href={lostForm} className={`${btn} bg-red-700 text-white hover:bg-red-800`}>
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">heart_broken</span>املأ الاستمارة
          </Link>
        )}
        {perm.can_edit && open && !lostForm && (
          <>
            {t.status === "جديدة" && (
              <button type="button" onClick={() => a.setStatus(t.id, "قيد التنفيذ", null, t.version)} disabled={a.busy}
                className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}>
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">play_arrow</span>ابدأ
              </button>
            )}
            {!pending && (
              <button type="button" onClick={complete} disabled={a.busy} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{needsApproval ? "send" : "check"}</span>
                {needsApproval ? "أرسل للموافقة" : "أنجز"}
              </button>
            )}
          </>
        )}
        {perm.can_edit && !open && (
          <button type="button" onClick={() => a.setStatus(t.id, "جديدة", null, t.version)} disabled={a.busy} className={ghost}>
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">undo</span>أعد فتحها
          </button>
        )}
        {perm.can_edit && (
          <Link href={`/dashboard/tasks/${t.id}/edit`} className={ghost}>
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">edit</span>تعديل
          </Link>
        )}
        {perm.can_edit && open && people.length > 1 && (
          <button type="button" onClick={() => setPanel(panel === "reassign" ? "" : "reassign")} className={ghost} aria-expanded={panel === "reassign"}>
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">swap_horiz</span>إعادة إسناد
          </button>
        )}
        {perm.can_edit && open && (
          <Link href={`/dashboard/tasks/new?parent=${t.id}`} className={ghost}>
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">subdirectory_arrow_left</span>مهمة فرعية
          </Link>
        )}
        {perm.can_edit && open && (
          t.blocked_reason ? (
            <button type="button" onClick={() => a.save({ id: t.id, version: t.version, blocked_reason: "" })} disabled={a.busy} className={ghost}>
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">play_circle</span>استئناف
            </button>
          ) : (
            <button type="button" onClick={() => setPanel(panel === "block" ? "" : "block")} className={ghost} aria-expanded={panel === "block"}>
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">pause_circle</span>إيقاف مؤقت
            </button>
          )
        )}
        <button type="button" onClick={() => a.watch(t.id, !perm.is_watching)} disabled={a.busy} className={ghost}>
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{perm.is_watching ? "visibility_off" : "visibility"}</span>
          {perm.is_watching ? "إلغاء المتابعة" : "تابِع"}
        </button>
        {t.task_type !== "lost_analysis" && (
          <button type="button" onClick={duplicate} disabled={a.busy} className={ghost}>
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">content_copy</span>نسخ
          </button>
        )}
        {perm.can_edit && !open && (
          <button type="button" onClick={() => a.archive(t.id, !t.archived_at)} disabled={a.busy} className={ghost}>
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{t.archived_at ? "unarchive" : "archive"}</span>
            {t.archived_at ? "إخراج من الأرشيف" : "أرشفة"}
          </button>
        )}
        {perm.can_edit && open && !lostForm && (
          <button type="button" onClick={() => setPanel(panel === "cancel" ? "" : "cancel")} className={`${btn} text-red-600 hover:bg-red-50`} aria-expanded={panel === "cancel"}>
            إلغاء المهمة
          </button>
        )}
        {perm.can_delete && (
          <button type="button" onClick={remove} disabled={a.busy} className={`${btn} text-red-600 hover:bg-red-50`}>حذف</button>
        )}
      </div>

      {/* خطوة المسار */}
      {perm.can_edit && open && detail.workflow_steps.length > 0 && (
        <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-600">الخطوة:</span>
          <select value={t.workflow_step_id ?? ""} onChange={(e) => e.target.value && a.setStep(t.id, e.target.value, t.version)}
            disabled={a.busy} className="rounded-lg border border-gray-300 px-2.5 py-1.5">
            {detail.workflow_steps.map((s) => (
              <option key={s.id} value={s.id}>{s.position}. {s.name}{s.is_approval ? " (موافقة)" : ""}</option>
            ))}
          </select>
        </label>
      )}

      {panel === "cancel" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-50 p-3">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
            placeholder={perm.cancel_reason_required ? "سبب الإلغاء (مطلوب)" : "سبب الإلغاء (اختياري)"}
            className="min-w-0 flex-1 rounded-lg border border-red-200 px-3 py-2 text-sm" />
          <button type="button" onClick={cancel} disabled={a.busy || (perm.cancel_reason_required && !reason.trim())}
            className={`${btn} bg-red-600 text-white`}>تأكيد الإلغاء</button>
        </div>
      )}
      {panel === "block" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="لماذا توقّفت؟ (تنتظر ماذا)"
            className="min-w-0 flex-1 rounded-lg border border-amber-200 px-3 py-2 text-sm" />
          <button type="button" onClick={block} disabled={a.busy || !reason.trim()} className={`${btn} bg-amber-600 text-white`}>إيقاف</button>
        </div>
      )}
      {panel === "reassign" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 p-3">
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-lg border border-gray-300 px-2.5 py-2 text-sm" aria-label="المسؤول الجديد">
            <option value="">المسؤول الجديد…</option>
            {people.filter((p) => p.user_id !== t.assigned_to).map((p) => (
              <option key={p.user_id} value={p.user_id}>{p.name}{p.is_me ? " (أنا)" : ""}</option>
            ))}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة للمسؤول الجديد (اختياري)" maxLength={500}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <button type="button" onClick={reassign} disabled={a.busy || !assignee} className={`${btn} bg-brand-600 text-white`}>إسناد</button>
        </div>
      )}

      {(a.error || msg) && (
        <p role={a.error ? "alert" : "status"} className={`mt-3 rounded-lg px-3 py-2 text-sm ${a.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
          {a.error ?? msg}
        </p>
      )}
    </div>
  );
}
