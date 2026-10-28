import { createClient } from "@/lib/supabase/server";

// ============================================================
// مركز الليدات (218) — قراءة الدفتر واللوحة.
//
// crm_lead_intake هو دفتر الوارد: كل ليد من أي باب له فيه صفّ. والأرقام
// هنا تُحسب في القاعدة (lead_hub_summary / lead_hub_breakdown، definer
// بفحص can_view_lead_hub) — مجاميع لا صفوف أشخاص، فيقرؤها التسويق أيضاً.
// أما صفوف قائمة الأخطاء (بأسماء وهواتف) فتمرّ بـ RLS: المدير ومدير
// المتابعة ومدير التسويق وحدهم.
// ============================================================

export { PROVIDER_LABEL, CHANNEL_OPTIONS, channelLabel, pct, minutesLabel } from "@/lib/leads-shared";

export type LeadHubSummary = {
  received: number; created: number; linked: number; rejected: number; pending: number;
  assigned: number; contacted: number; in_sla: number;
  avg_first_min: number | null; median_first_min: number | null;
  reserved: number; sold: number; sla_hours: number;
  by_provider: Record<string, number>;
  today: number; week: number; month: number;
  q_errors: number; q_rejected: number; q_unassigned: number; q_no_contact: number;
  q_overdue: number; q_followup_late: number;
  sources: { provider: string; last_at: string; n_30d: number }[];
  meta_connected: boolean; meta_last_sync: string | null;
};

export type LeadBreakdownRow = {
  k: string | null; label: string | null;
  received: number; created: number; linked: number; rejected: number; pending: number;
  unassigned: number; contacted: number; in_sla: number; avg_first_min: number | null;
  reserved: number; sold: number; platform_leads: number | null;
};

export type IntakeRow = {
  id: string; received_at: string; provider: string; channel: string | null; status: string;
  name: string | null; phone: string | null; email: string | null; campaign_ref: string | null;
  reject_reason: string | null; last_error: string | null; attempts: number; message: string | null;
  client_id: string | null; batch_id: string | null;
};

export type ImportBatch = {
  id: string; file_name: string | null; created_at: string; finished_at: string | null;
  rows_sent: number; rows_already: number; campaign_id: string | null; channel: string | null;
};

export type BreakdownDim = "campaign" | "provider" | "channel" | "owner" | "project";

export async function getLeadHubSummary(from: string, to: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lead_hub_summary", { p_from: from, p_to: to });
  return { data: (data ?? null) as LeadHubSummary | null, error: error?.message ?? null };
}

export async function getLeadBreakdown(from: string, to: string, dim: BreakdownDim) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lead_hub_breakdown", { p_from: from, p_to: to, p_dim: dim });
  return { data: (data ?? []) as LeadBreakdownRow[], error: error?.message ?? null };
}

// ما ينتظر قراراً: أخطاء، وبانتظار الجلب، ومرفوض لم يُعالَج
export async function getIntakeQueue(limit = 300) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_lead_intake")
    .select("id, received_at, provider, channel, status, name, phone, email, campaign_ref, reject_reason, last_error, attempts, message, client_id, batch_id")
    .in("status", ["خطأ", "بانتظار الجلب", "مرفوض", "جديد"])
    .is("resolved_at", null)
    .neq("provider", "legacy")
    .order("received_at", { ascending: false })
    .limit(limit);
  return { data: (data ?? []) as IntakeRow[], error: error?.message ?? null };
}

export async function getImportBatches(limit = 30) {
  const supabase = await createClient();
  const { data: batches } = await supabase
    .from("lead_import_batches")
    .select("id, file_name, created_at, finished_at, rows_sent, rows_already, campaign_id, channel")
    .order("created_at", { ascending: false })
    .limit(limit);
  const list = (batches ?? []) as ImportBatch[];
  // النتيجة من الدفتر نفسه لا من عدّاد يُكتب مرتين
  const counts = new Map<string, Record<string, number>>();
  if (list.length) {
    const { data: rows } = await supabase
      .from("crm_lead_intake")
      .select("batch_id, status")
      .in("batch_id", list.map((b) => b.id));
    for (const r of (rows ?? []) as { batch_id: string; status: string }[]) {
      const m = counts.get(r.batch_id) ?? {};
      m[r.status] = (m[r.status] ?? 0) + 1;
      counts.set(r.batch_id, m);
    }
  }
  return list.map((b) => ({ ...b, counts: counts.get(b.id) ?? {} }));
}
