import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// مسار البيع من بطاقة العميل (sql/201).
//
// المرحلة الحالية مصدرها المسار (opportunities.stage_id) وحده، والبطاقة
// مرآة تكتبها القاعدة. فالواجهة لا تكتب clients.stage أبداً — تطلب
// النقل من الباب الواحد crm_move_client_stage، وهو يقرّر.
//
// stageMoveIntent مرآة قواعد الحارس guard_opportunity_stage والباب في
// القاعدة: يخبر الواجهة أيّ نافذة تفتح **قبل** الإرسال. القاعدة تبقى
// الحَكَم — من تجاوز الواجهة رُفض هناك برسالة.
// ============================================================

export type StageKind = "open" | "won" | "lost" | "closed";

export type StageRule = {
  name: string;
  type?: StageKind;
  lost?: boolean;
  closed?: boolean;
  requiresReason?: boolean;
  manual?: boolean;
};

export type StageMoveIntent =
  | "none"         // نفس المرحلة
  | "direct"       // يُرسل مباشرة
  | "reason"       // يُسأل عن السبب أولاً (إغلاق غير تجاري، أو عودة منه)
  | "lost_form"    // نموذج «تحليل سبب فقدان فرصة البيع»
  | "reactivate"   // العميل خاسر: إعادة تنشيط بسبب وموعد
  | "reservation"  // «حجز» لا يُختار — يُحجز من تبويب العقار
  | "won_locked";  // اشترى: مسار شراء إضافي، والتصحيح للمدير

export function stageKind(s: StageRule | undefined | null): StageKind {
  if (!s) return "open";
  if (s.type) return s.type;
  if (s.lost) return "lost";
  if (s.closed) return s.name === "بيع" ? "won" : "closed";
  return "open";
}

export function stageMoveIntent(
  current: StageRule | undefined | null,
  target: StageRule,
  opts: { isAdmin?: boolean } = {}
): StageMoveIntent {
  if (current && current.name === target.name) return "none";
  const from = stageKind(current);
  const to = stageKind(target);

  if (to === "lost") return "lost_form";
  if (from === "lost") return "reactivate";
  if (target.manual === false) return "reservation";
  if (from === "won" && to !== "won") return opts.isAdmin ? "reason" : "won_locked";
  if (target.requiresReason) return "reason";
  if (from === "closed" && to === "open") return "reason";
  return "direct";
}

export type MoveResult =
  | { ok: true; changed: boolean; journeyId: string | null; clientStage: string | null }
  | { ok: false; message: string; hint: string | null };

// تلميحات القاعدة (hint) التي تعني «افتح نافذة» لا «فشل»
export const MOVE_HINTS = [
  "close_opportunity_lost",
  "reactivate_lost_opportunity",
  "stage_reason",
  "reserve_unit",
  "start_journey",
  "cancel_sale",
] as const;

export async function moveClientStage(
  supabase: SupabaseClient,
  clientId: string,
  stage: string,
  reason?: string | null,
  journeyId?: string | null
): Promise<MoveResult> {
  const { data, error } = await supabase.rpc("crm_move_client_stage", {
    p_client_id: clientId,
    p_stage: stage,
    p_reason: reason?.trim() || null,
    p_journey_id: journeyId ?? null,
  });
  if (error) {
    return { ok: false, message: error.message, hint: (error as { hint?: string | null }).hint ?? null };
  }
  const d = (data ?? {}) as { changed?: boolean; journey_id?: string; client_stage?: string };
  return {
    ok: true,
    changed: Boolean(d.changed),
    journeyId: d.journey_id ?? null,
    clientStage: d.client_stage ?? null,
  };
}

// المسار الحالي للبطاقة — لإعادة التنشيط ولربط النوافذ بالمسار الصحيح
export async function currentJourneyId(supabase: SupabaseClient, clientId: string): Promise<string | null> {
  const { data } = await supabase.from("clients").select("current_journey_id").eq("id", clientId).maybeSingle();
  return ((data as { current_journey_id?: string | null } | null)?.current_journey_id) ?? null;
}

// عمر المرحلة بالأيام — من stage_entered_at (مرآة المسار)
export function daysInStage(enteredAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!enteredAt) return null;
  const t = new Date(enteredAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000));
}

// «يحتاج إجراء»: مسار مفتوح بلا موعد، أو موعده فات، أو لم يُتواصل معه قطّ
export function needsAction(
  c: { follow_up_date: string | null; last_contact_at: string | null },
  open: boolean,
  today: string
): "overdue" | "no_date" | "never_contacted" | null {
  if (!open) return null;
  if (!c.last_contact_at) return "never_contacted";
  if (!c.follow_up_date) return "no_date";
  if (c.follow_up_date < today) return "overdue";
  return null;
}

// رابط مسارٍ في ملفّ عميله (تبويب «المسار»). بلا عميل معروف: الرابط
// القديم يعمل ويُحوِّل إلى المكان نفسه.
export function journeyHref(clientId: string | null | undefined, journeyId: string, analyse?: string | null): string {
  if (!clientId) {
    return `/dashboard/crm/opportunities/${journeyId}${analyse ? `?tab=lost&analyse=${analyse}` : ""}`;
  }
  const q = new URLSearchParams({ tab: "journey", journey: journeyId });
  if (analyse) q.set("analyse", analyse);
  return `/dashboard/clients/${clientId}?${q.toString()}`;
}
