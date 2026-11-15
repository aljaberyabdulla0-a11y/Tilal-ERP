// ============================================================
// قواعد يوم المتابعة (sql/225):
//   • لا متابعة يوم الجمعة — عطلة.
//   • سقف يومي للموظف (30 افتراضياً — إعداد followup_daily_cap).
//
// الفرض الحقيقي في القاعدة (محفّز على clients.follow_up_date) فلا
// يُتجاوز من أي واجهة. هذا الملف للتنبيه المبكر فقط: يخبر الموظف قبل
// الحفظ بدل أن يُفاجأ برفضه.
// ============================================================

export const FOLLOWUP_DAY_OFF_MSG =
  "لا يمكن تحديد موعد متابعة يوم الجمعة لأنه عطلة — اختر يوماً آخر.";

const AR_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// يوم الأسبوع لتاريخ YYYY-MM-DD (0 = الأحد) — بلا تأثّر بمنطقة الجهاز
function dayOfWeek(date: string): number | null {
  if (!ISO_DATE.test(date)) return null;
  const d = new Date(date + "T12:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

export function isFollowupDayOff(date: string | null | undefined): boolean {
  return !!date && dayOfWeek(date) === 5;
}

export function arDayName(date: string): string {
  const dow = dayOfWeek(date);
  return dow === null ? "" : AR_DAYS[dow];
}

// ما ترجعه public.followup_day_status(client, date)
export type FollowupDayStatus = {
  day_off: boolean;
  count: number;      // متابعات الموظف في ذلك اليوم — عدا هذا العميل
  cap: number;
  full: boolean;
  next_free: string | null;
  next_free_day: string | null;
};

export type FollowupDayHint = {
  tone: "ok" | "warn" | "block";
  text: string;
  suggest: string | null; // أقرب يوم متاح — يُعرض زراً
};

// نصّ التنبيه تحت حقل الموعد. status = null: لم تصل حالة اليوم (أو
// القاعدة لم تُحدَّث بعد) — نكتفي بفحص الجمعة المحلي.
export function followupDayHint(
  date: string,
  status: FollowupDayStatus | null
): FollowupDayHint | null {
  if (!date) return null;

  if (isFollowupDayOff(date)) {
    return { tone: "block", text: FOLLOWUP_DAY_OFF_MSG, suggest: status?.next_free ?? null };
  }
  if (!status) return null;

  if (status.full) {
    return {
      tone: "block",
      text: `${arDayName(date)} ممتلئ: ${status.count} متابعة من أصل ${status.cap} — اختر يوماً آخر.`,
      suggest: status.next_free,
    };
  }

  const left = status.cap - status.count;
  return {
    tone: left <= Math.max(1, Math.round(status.cap * 0.15)) ? "warn" : "ok",
    text: `${arDayName(date)}: ${status.count} متابعة من أصل ${status.cap} — بقي ${left}.`,
    suggest: null,
  };
}
