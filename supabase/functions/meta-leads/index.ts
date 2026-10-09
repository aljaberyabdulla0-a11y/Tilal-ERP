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
// Security:
//   • GET (subscription verification): hub.verify_token = META_VERIFY_TOKEN.
//   • POST: the X-Hub-Signature-256 signature with HMAC-SHA256 of the raw body using the META_APP_SECRET key —
//     a request without a valid signature is rejected. So verify_jwt = false at deploy (Meta doesn't send a JWT).
//   • The page token (leads_retrieval) is in Vault on a Meta integration (126), read only by service_role.
//     The integration is chosen by page_ref (195) = the page id in the event, otherwise the first active Meta integration.
//
// Linking to the campaign: if the ad is known in mkt_ad_objects (the marketing-sync sync creates it) the touchpoint inherits
// its campaign; otherwise mapping.campaigns, a Tilal campaign whose code is the Meta campaign id, or cmp-0001 in its name.
// The page must be subscribed to the app (leadgen) — «اشترك الصفحة» on the integrations screen (marketing-sync).
//
// Errors don't stop the response: Meta retries for hours on any non-200 response, so the lead's
// error is logged in mkt_event_errors (it appears in «data quality») and 200 is returned.
//
// Variables: META_APP_SECRET, META_VERIFY_TOKEN (supabase secrets set …) + the automatic ones.
// Deploy:    supabase functions deploy meta-leads --no-verify-jwt
// Meta link: https://<project>.supabase.co/functions/v1/meta-leads  (field: leadgen)
// ============================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v21.0";

type Integration = { id: string; page_ref: string | null; mapping: { page_id?: string; campaigns?: Record<string, string> } | null };
type LeadChange = { leadgen_id?: string; page_id?: string; form_id?: string; ad_id?: string; created_time?: number };
type FieldDatum = { name: string; values: string[] };

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

  const raw = await req.text();
  const secret = Deno.env.get("META_APP_SECRET");
  if (!secret || !(await validSignature(raw, req.headers.get("x-hub-signature-256"), secret))) {
    return new Response("invalid signature", { status: 401 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  let body: { object?: string; entry?: { id?: string; changes?: { field?: string; value?: LeadChange }[] }[] };
  try { body = JSON.parse(raw); } catch { return new Response("ok", { status: 200 }); }
  if (body.object !== "page") return new Response("ok", { status: 200 });

  let handled = 0;
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "leadgen" || !ch.value?.leadgen_id) continue;
      try {
        await handleLead(admin, { ...ch.value, page_id: ch.value.page_id ?? entry.id });
        handled++;
      } catch (e) {
        await logError(admin, e instanceof Error ? e.message : String(e), { leadgen_id: ch.value.leadgen_id, page_id: ch.value.page_id });
      }
    }
  }
  return new Response(JSON.stringify({ ok: true, handled }), { status: 200, headers: { "Content-Type": "application/json" } });
});

async function handleLead(admin: SupabaseClient, v: LeadChange) {
  const leadId = String(v.leadgen_id);

  // Already received? (Meta resends the same event) — the gateway rejects duplicates too, but we spare a Graph call
  const { data: seen } = await admin.from("crm_lead_intake").select("id").eq("provider", "meta").eq("external_id", leadId).maybeSingle();
  if (seen) return;

  const integ = await pickIntegration(admin, v.page_id ?? null);
  if (!integ) throw new Error("لا تكامل Meta فعّال — أضِفه من شاشة التكاملات بمعرّف الصفحة");
  const { data: token } = await admin.rpc("mkt_integration_secret", { p_integration: integ.id });
  if (!token) throw new Error("تكامل Meta بلا مفتاح — اضبط رمز الصفحة (leads_retrieval) من شاشة التكاملات");

  const res = await fetch(`${GRAPH}/${leadId}?fields=created_time,field_data,ad_id,ad_name,campaign_id,campaign_name,form_id,platform,is_organic`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const lead = await res.json().catch(() => ({})) as {
    created_time?: string; field_data?: FieldDatum[]; ad_id?: string; ad_name?: string; campaign_id?: string;
    campaign_name?: string; form_id?: string; platform?: string; is_organic?: boolean; error?: { message?: string };
  };
  if (!res.ok) throw new Error(`Meta ${res.status}: ${lead.error?.message ?? "تعذّرت قراءة الليد"}`);

  const fields = new Map((lead.field_data ?? []).map((f) => [f.name.toLowerCase(), (f.values ?? [])[0] ?? ""]));
  const name = fields.get("full_name") || [fields.get("first_name"), fields.get("last_name")].filter(Boolean).join(" ") || null;
  const phone = fields.get("phone_number") || fields.get("phone") || null;
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
  const tilalId = adCampaign ?? (lead.campaign_id ? integ.mapping?.campaigns?.[lead.campaign_id] : undefined) ?? null;
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
  const { data: intake, error } = await admin.from("crm_lead_intake").insert({
    provider: "meta",
    external_id: leadId,
    received_at: lead.created_time ?? new Date().toISOString(),
    name, phone,
    raw: {
      utm: { utm_source: source, utm_medium: lead.is_organic ? "organic" : "paid_social",
             ...(campaignCode ? { utm_campaign: campaignCode } : {}), ...(adId ? { utm_content: `ad-${adId}` } : {}) },
      mkt: { ...(adObject ? { ad_object_id: adObject } : {}) },
      meta: { form_id: lead.form_id ?? v.form_id ?? null, ad_id: adId, ad_name: lead.ad_name ?? null,
              campaign_id: lead.campaign_id ?? null, campaign_name: lead.campaign_name ?? null, page_id: v.page_id ?? null },
      extra,
    },
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return;   // a duplicate arrived at the same moment
    throw new Error(`حفظ الليد: ${error.message}`);
  }
  const { error: e2 } = await admin.rpc("intake_lead", { p_intake_id: (intake as { id: string }).id });
  if (e2) throw new Error(`تحويل الليد: ${e2.message}`);
}

async function pickIntegration(admin: SupabaseClient, pageId: string | null): Promise<Integration | null> {
  const { data } = await admin.from("mkt_integrations").select("id, page_ref, mapping").eq("provider", "meta").eq("is_active", true);
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

async function logError(admin: SupabaseClient, message: string, context: Record<string, unknown>) {
  await admin.from("mkt_event_errors").insert({ source: "meta-leads", message: message.slice(0, 1000), context });
}
