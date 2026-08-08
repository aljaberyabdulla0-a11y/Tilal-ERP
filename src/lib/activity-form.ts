// ============================================================
// منطق نموذج تسجيل التواصل: التعبئة والتحقّق وبناء ما يُحفظ.
// مفصول عن الواجهة عمداً — مصدر واحد للحقيقة يستخدمه نموذج
// التسجيل ونموذج التعديل معاً، وقابل للاختبار مباشرة.
// ============================================================

import type { ClientActivity } from "@/lib/types";
import { activityMeta } from "@/lib/types";
import { baghdadDate, baghdadStamp, baghdadTime } from "@/lib/time";

export type ActivityFormState = {
  activity_type: string;
  date: string;
  time: string;
  direction: string;
  outcome: string;
  duration: string;
  summary: string;
  next_action: string;
  next_date: string;
};

// نموذج فارغ لتواصل جديد — مملوء بوقت الآن بتوقيت بغداد
export function newActivityForm(type: string): ActivityFormState {
  return {
    activity_type: type,
    date: baghdadDate(),
    time: baghdadTime(new Date()),
    direction: "صادر",
    outcome: "تم التواصل",
    duration: "",
    summary: "",
    next_action: "",
    next_date: "",
  };
}

// تعبئة النموذج من سجلّ موجود (للتعديل)
export function activityFormFrom(a: ClientActivity): ActivityFormState {
  return {
    activity_type: a.activity_type,
    date: baghdadDate(a.occurred_at),
    time: baghdadTime(a.occurred_at),
    direction: a.direction ?? "صادر",
    outcome: a.outcome ?? "تم التواصل",
    duration: a.duration_min != null ? String(a.duration_min) : "",
    summary: a.summary ?? "",
    next_action: a.next_action ?? "",
    next_date: a.next_action_date ?? "",
  };
}

export type ActivityPayload = {
  activity_type: string;
  direction: string | null;
  outcome: string | null;
  occurred_at: string;
  duration_min: number | null;
  summary: string | null;
  next_action: string | null;
  next_action_date: string;
};

export const FOLLOWUP_REQUIRED_MSG =
  "حدّد موعد المتابعة القادم — إلزامي في كل الحالات.";

// التحقّق وبناء ما يُحفظ
export function buildActivityPayload(
  f: ActivityFormState
): { error: string } | { payload: ActivityPayload } {
  const occurredAt = baghdadStamp(f.date, f.time);
  if (!occurredAt) return { error: "تاريخ أو وقت التواصل غير صحيح." };
  if (new Date(occurredAt).getTime() > Date.now() + 60000) {
    return { error: "لا يمكن تسجيل تواصل في المستقبل." };
  }

  // موعد المتابعة إلزامي في كل المراحل — حتى لا يبقى عميل بلا خطوة تالية
  if (!f.next_date) return { error: FOLLOWUP_REQUIRED_MSG };
  if (f.next_date < f.date) {
    return { error: "موعد المتابعة يجب أن يكون في نفس يوم التواصل أو بعده." };
  }

  const meta = activityMeta(f.activity_type);
  return {
    payload: {
      activity_type: f.activity_type,
      direction: meta.hasDirection ? f.direction : null,
      outcome: f.activity_type === "ملاحظة" ? null : f.outcome,
      occurred_at: occurredAt,
      duration_min: meta.hasDuration && f.duration ? Number(f.duration) : null,
      summary: f.summary.trim() || null,
      next_action: f.next_action.trim() || null,
      next_action_date: f.next_date,
    },
  };
}
