// ============================================================
// meta-leads — receiving Meta Instant Form leads (Facebook / Instagram Lead Ads)
//
// The path:  Meta (Webhook: leadgen) ──► this function ──► crm_lead_intake (provider 'meta')
//                                               │                       │ trg_mkt_intake_resolve (124)
//                                               ▼                       ▼
//                                     Graph: /{leadgen_id}       intake_lead() ──► clients + distribution
//                                                                        │ trg_mkt_intake_touchpoint (195)
//                                                                        ▼
//                                                      a «نموذج» touchpoint on its ad and its campaign
//
// No new path to the clients table: the existing gateway, its normalisation and its duplicate detection.
//
// Store first, fetch second (218): the event is written as «بانتظار الجلب» before the Graph call, so a
// missing token, an expired token or a Graph outage leaves a visible row that is retried — not a line
// in a log. Two more entries arrive with the x-cron-secret header (pg_cron + pg_net, sql/218):
//   { mode: "retry" }  every 15 minutes —
//       1) re-fetch rows still «بانتظار الجلب» / «خطأ» without details (exponential back-off,
//          crm_settings.lead_intake_max_attempts);
//       2) sweep: once an hour per integration, list the page's forms and their leads since the last
//          sweep (mkt_integrations.lead_sweep_at). Any lead the webhook never delivered is written now.
//          The unique (provider, external_id) makes the sweep and the webhook idempotent together.
//
// Security:
//   • GET (subscription verification): hub.verify_token = META_VERIFY_TOKEN.
//   • POST from Meta: the X-Hub-Signature-256 signature with HMAC-SHA256 of the raw body using the
//     META_APP_SECRET key — a request without a valid signature is rejected. So verify_jwt = false.
//   • POST from the scheduler: x-cron-secret checked against Vault (mkt_cron_secret_ok, sql/200).
//   • The page token (leads_retrieval) is in Vault on a Meta integration (126), read only by service_role.
//     The integration is chosen by page_ref (195) = the page id in the event, otherwise the first active Meta integration.
//
// Linking to the campaign: if the ad is known in mkt_ad_objects (the marketing-sync sync creates it) the touchpoint inherits
// its campaign; otherwise mapping.campaigns, a Tilal campaign whose code is the Meta campaign id, or cmp-0001 in its name.
// The page must be subscribed to the app (leadgen) — «اشترك الصفحة» on the integrations screen (marketing-sync).
//
// Errors don't stop the response: Meta retries for hours on any non-200 response, so the lead stays in
// crm_lead_intake as «خطأ» (it appears in /dashboard/crm/leads) and 200 is returned.
//
// Variables: META_APP_SECRET, META_VERIFY_TOKEN (supabase secrets set …) + the automatic ones.
// Deploy:    supabase functions deploy meta-leads --no-verify-jwt
// Meta link: https://<project>.supabase.co/functions/v1/meta-leads  (field: leadgen)
// ============================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v21.0";
const LEAD_FIELDS = "id,created_time,field_data,ad_id,ad_name,campaign_id,campaign_name,form_id,platform,is_organic";
const SWEEP_EVERY_MS = 55 * 60 * 1000;
const SWEEP_FIRST_DAYS = 3;

type Integration = {
  id: string; page_ref: string | null; lead_sweep_at: string | null;
  mapping: { page_id?: string; campaigns?: Record<string, string> } | null;
};
type LeadChange = { leadgen_id?: string; page_id?: string; form_id?: string; ad_id?: string; created_time?: number };
type FieldDatum = { name: string; values: string[] };
type GraphLead = {
  id?: string; created_time?: string; field_data?: FieldDatum[]; ad_id?: string; ad_name?: string; campaign_id?: string;
  campaign_name?: string; form_id?: string; platform?: string; is_organic?: boolean; error?: { message?: string };
};
type IntakeRow = { id: string; external_id: string; attempts: number; raw: { webhook?: LeadChange } | null };

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ===== subscription verification =====
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe"
      && Deno.env.get("META_VERIFY_TOKEN")
      && url.searchParams.get("hub.verify_token") === Deno.env.get("META_VERIFY_TOKEN");
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("POST فقط", { status: 405 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const raw = await req.text();

  // ===== the scheduler (sql/218) =====
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    const ok = (await admin.rpc("mkt_cron_secret_ok", { p_secret: cron })).data === true;
    if (!ok) return new Response("forbidden", { status: 401 });
    const result = { retried: 0, swept: 0, errors: [] as string[] };
    try { result.retried = await retryPending(admin); } catch (e) { result.errors.push(msg(e)); }
    try { result.swept = await sweepForms(admin); } catch (e) { result.errors.push(msg(e)); }
    return json(result);
  }

  // ===== Meta =====
  const secret = Deno.env.get("META_APP_SECRET");
  if (!secret || !(await validSignature(raw, req.headers.get("x-hub-signature-256"), secret))) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: { object?: string; entry?: { id?: string; changes?: { field?: string; value?: LeadChange }[] }[] };
  try { body = JSON.parse(raw); } catch { return new Response("ok", { status: 200 }); }
  if (body.object !== "page") return new Response("ok", { status: 200 });

  let handled = 0;
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "leadgen" || !ch.value?.leadgen_id) continue;
      const v = { ...ch.value, page_id: ch.value.page_id ?? entry.id };
      try {
        const row = await storeEvent(admin, v);
        if (row) await processRow(admin, row, v);
        handled++;
      } catch (e) {
        // storeEvent itself failed (the database is unreachable): the only trace left is the log —
        // and the hourly form sweep, which will pick this lead up from Graph
        await logError(admin, msg(e), { leadgen_id: v.leadgen_id, page_id: v.page_id });
      }
    }
  }
  return json({ ok: true, handled });
});

// The webhook event is written before anything else. Returns null when the row is already past
// fetching (Meta resent an event that was handled).
async function storeEvent(admin: SupabaseClient, v: LeadChange): Promise<IntakeRow | null> {
  const leadId = String(v.leadgen_id);
  await admin.from("crm_lead_intake").upsert({
    provider: "meta",
    external_id: leadId,
    status: "بانتظار الجلب",
    received_at: v.created_time ? new Date(v.created_time * 1000).toISOString() : new Date().toISOString(),
    raw: { webhook: v },
    form_ref: v.form_id ?? null,
    ad_ref: v.ad_id ?? null,
  }, { onConflict: "provider,external_id", ignoreDuplicates: true });

  const { data, error } = await admin.from("crm_lead_intake")
    .select("id, external_id, attempts, raw, status").eq("provider", "meta").eq("external_id", leadId).maybeSingle();
  if (error || !data) throw new Error(`حفظ حدث الليد: ${error?.message ?? "لم يُحفظ"}`);
  const row = data as IntakeRow & { status: string };
  return row.status === "بانتظار الجلب" || row.status === "خطأ" ? row : null;
}

// Fetch the lead (unless the sweep already holds it), fill the row, convert it. Failure ⇒ «خطأ» + back-off.
async function processRow(admin: SupabaseClient, row: IntakeRow, v: LeadChange, prefetched?: GraphLead) {
  try {
    let lead = prefetched;
    let integ: Integration | null = null;
    if (!lead) {
      integ = await pickIntegration(admin, v.page_id ?? null);
      if (!integ) throw new Error("لا تكامل Meta فعّال — أضِفه من شاشة التكاملات بمعرّف الصفحة");
      const token = await integrationToken(admin, integ.id);
      const res = await fetch(`${GRAPH}/${row.external_id}?fields=${LEAD_FIELDS}`, { headers: { Authorization: `Bearer ${token}` } });
      lead = await res.json().catch(() => ({})) as GraphLead;
      if (!res.ok) throw new Error(`Meta ${res.status}: ${lead.error?.message ?? "تعذّرت قراءة الليد"}`);
    }
    integ ??= await pickIntegration(admin, v.page_id ?? null);
    await fillAndConvert(admin, row, v, lead, integ);
  } catch (e) {
    const attempts = (row.attempts ?? 0) + 1;
    const backoffMin = 5 * 2 ** Math.min(attempts - 1, 7);
    await admin.from("crm_lead_intake").update({
      status: "خطأ",
      attempts,
      last_error: msg(e).slice(0, 1000),
      next_retry_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
    }).eq("id", row.id);
  }
}

async function fillAndConvert(admin: SupabaseClient, row: IntakeRow, v: LeadChange, lead: GraphLead, integ: Integration | null) {
  const fields = new Map((lead.field_data ?? []).map((f) => [f.name.toLowerCase(), (f.values ?? [])[0] ?? ""]));
  const name = fields.get("full_name") || [fields.get("first_name"), fields.get("last_name")].filter(Boolean).join(" ") || null;
  const phone = fields.get("phone_number") || fields.get("phone") || null;
  const email = fields.get("email") || null;
  const extra = Object.fromEntries([...fields].filter(([k]) => !["full_name", "first_name", "last_name", "phone_number", "phone", "email"].includes(k)));

  // The ad in Tilal (if the sync created it) — the touchpoint inherits its campaign through it
  const adId = lead.ad_id ?? v.ad_id ?? null;
  let adObject: string | null = null;
  let adCampaign: string | null = null;
  if (adId) {
    const { data } = await admin.from("mkt_ad_objects").select("id, campaign_id").eq("level", "إعلان").eq("external_id", adId).limit(1).maybeSingle();
    adObject = (data as { id: string } | null)?.id ?? null;
    adCampaign = (data as { campaign_id: string | null } | null)?.campaign_id ?? null;
  }
  // The client card needs the campaign too (utm_campaign → campaign_ref by code, 124), not only the touchpoint:
  // the ad's Tilal campaign, an explicit mapping, a Tilal campaign whose code is the Meta campaign id, or cmp-0001 in its name
  let campaignCode: string | null = null;
  const tilalId = adCampaign ?? (lead.campaign_id ? integ?.mapping?.campaigns?.[lead.campaign_id] : undefined) ?? null;
  if (tilalId) {
    const { data } = await admin.from("crm_campaigns").select("code").eq("id", tilalId).maybeSingle();
    campaignCode = (data as { code: string } | null)?.code ?? null;
  }
  if (!campaignCode && lead.campaign_id) {
    const { data } = await admin.from("crm_campaigns").select("code").eq("code", lead.campaign_id).limit(1).maybeSingle();
    campaignCode = (data as { code: string } | null)?.code ?? null;
  }
  campaignCode ??= (String(lead.campaign_name ?? "").toLowerCase().match(/cmp-\d{4}/) ?? [null])[0];

  const source = lead.platform === "ig" ? "instagram" : "facebook";
  const { error } = await admin.from("crm_lead_intake").update({
    status: "جديد",
    received_at: lead.created_time ?? undefined,
    name, phone, email,
    channel: source,
    form_ref: lead.form_id ?? v.form_id ?? null,
    ad_ref: adId,
    last_error: null,
    raw: {
      ...(row.raw ?? {}),
      utm: { utm_source: source, utm_medium: lead.is_organic ? "organic" : "paid_social",
             ...(campaignCode ? { utm_campaign: campaignCode } : {}), ...(adId ? { utm_content: `ad-${adId}` } : {}) },
      mkt: { ...(adObject ? { ad_object_id: adObject } : {}) },
      meta: { form_id: lead.form_id ?? v.form_id ?? null, ad_id: adId, ad_name: lead.ad_name ?? null,
              campaign_id: lead.campaign_id ?? null, campaign_name: lead.campaign_name ?? null, page_id: v.page_id ?? null },
      extra,
    },
  }).eq("id", row.id);
  if (error) throw new Error(`حفظ الليد: ${error.message}`);

  // intake_lead never throws for a data problem (218): a failure there becomes «خطأ» and the database retries it
  const { error: e2 } = await admin.rpc("intake_lead", { p_intake_id: row.id });
  if (e2) throw new Error(`تحويل الليد: ${e2.message}`);
}

// ===== retry: rows still without details =====
async function retryPending(admin: SupabaseClient): Promise<number> {
  const { data: max } = await admin.rpc("crm_setting_int", { p_key: "lead_intake_max_attempts", p_default: 6 });
  const { data } = await admin.from("crm_lead_intake")
    .select("id, external_id, attempts, raw, next_retry_at")
    .eq("provider", "meta").in("status", ["بانتظار الجلب", "خطأ"]).is("phone", null)
    .lt("attempts", Number(max ?? 6))
    .order("received_at").limit(50);
  const due = ((data ?? []) as (IntakeRow & { next_retry_at: string | null })[])
    .filter((r) => !r.next_retry_at || new Date(r.next_retry_at).getTime() <= Date.now());
  for (const row of due) {
    await processRow(admin, row, { ...(row.raw?.webhook ?? {}), leadgen_id: row.external_id });
  }
  return due.length;
}

// ===== sweep: what the webhook never delivered =====
async function sweepForms(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from("mkt_integrations").select("id, page_ref, mapping, lead_sweep_at").eq("provider", "meta").eq("is_active", true);
  let written = 0;
  for (const integ of (data ?? []) as Integration[]) {
    const page = integ.page_ref ?? integ.mapping?.page_id ?? null;
    if (!page) continue;
    const last = integ.lead_sweep_at ? new Date(integ.lead_sweep_at).getTime() : 0;
    if (Date.now() - last < SWEEP_EVERY_MS) continue;

    const startedAt = new Date().toISOString();
    // One hour of overlap: a lead created just before the last sweep but indexed after it is not missed
    const since = Math.floor((last ? last - 3600_000 : Date.now() - SWEEP_FIRST_DAYS * 86400_000) / 1000);
    const token = await integrationToken(admin, integ.id);

    const forms = await graphAll<{ id: string }>(`${GRAPH}/${page}/leadgen_forms?fields=id&limit=100`, token);
    for (const form of forms) {
      const filtering = encodeURIComponent(JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]));
      const leads = await graphAll<GraphLead>(`${GRAPH}/${form.id}/leads?fields=${LEAD_FIELDS}&filtering=${filtering}&limit=100`, token);
      if (leads.length === 0) continue;
      const ids = leads.map((l) => String(l.id));
      const { data: known } = await admin.from("crm_lead_intake").select("external_id, status")
        .eq("provider", "meta").in("external_id", ids);
      const done = new Set(((known ?? []) as { external_id: string; status: string }[])
        .filter((k) => k.status !== "بانتظار الجلب" && k.status !== "خطأ").map((k) => k.external_id));
      for (const lead of leads) {
        if (!lead.id || done.has(String(lead.id))) continue;
        const v: LeadChange = { leadgen_id: String(lead.id), page_id: page, form_id: form.id, ad_id: lead.ad_id };
        const row = await storeEvent(admin, { ...v, created_time: lead.created_time ? Math.floor(new Date(lead.created_time).getTime() / 1000) : undefined });
        if (!row) continue;
        await processRow(admin, row, v, lead);
        written++;
      }
    }
    await admin.from("mkt_integrations").update({ lead_sweep_at: startedAt }).eq("id", integ.id);
  }
  return written;
}

async function graphAll<T>(first: string, token: string, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = first;
  for (let i = 0; next && i < maxPages; i++) {
    const res = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({})) as { data?: T[]; paging?: { next?: string }; error?: { message?: string } };
    if (!res.ok) throw new Error(`Meta ${res.status}: ${body.error?.message ?? "تعذّرت القراءة"} — الرمز يحتاج leads_retrieval و pages_manage_ads`);
    out.push(...(body.data ?? []));
    next = body.paging?.next;
  }
  return out;
}

async function integrationToken(admin: SupabaseClient, integrationId: string): Promise<string> {
  const { data: token } = await admin.rpc("mkt_integration_secret", { p_integration: integrationId });
  if (!token) throw new Error("تكامل Meta بلا مفتاح — اضبط رمز الصفحة (leads_retrieval) من شاشة التكاملات");
  return token as string;
}

async function pickIntegration(admin: SupabaseClient, pageId: string | null): Promise<Integration | null> {
  const { data } = await admin.from("mkt_integrations").select("id, page_ref, mapping, lead_sweep_at").eq("provider", "meta").eq("is_active", true);
  const list = (data ?? []) as Integration[];
  const page = (i: Integration) => i.page_ref ?? i.mapping?.page_id ?? null;
  // The page's integration first; then any integration linked to a page; then the first one
  return list.find((i) => pageId && page(i) === pageId) ?? list.find((i) => page(i)) ?? list[0] ?? null;
}

async function validSignature(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });

async function logError(admin: SupabaseClient, message: string, context: Record<string, unknown>) {
  await admin.from("mkt_event_errors").insert({ source: "meta-leads", message: message.slice(0, 1000), context });
}
