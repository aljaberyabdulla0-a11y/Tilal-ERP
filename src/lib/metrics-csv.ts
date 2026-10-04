// ============================================================
// قراءة ملفّ مقاييس CSV — منطقٌ خالص يُختبر (metrics-csv.test.ts).
//
// يقبل قالب تلال (عناوين بأسماء أعمدة mkt_metrics_daily) وتصدير مدير
// إعلانات ميتا كما يخرج (Day, Ad ID, Amount spent (USD)…). والمصروف
// بالدولار يُضرب في سعر الصرف المُدخَل — القاعدة تحفظ بالدينار.
// والتحقّق النهائي في mkt_import_metrics: هنا تحويلٌ لا حُكم.
// ============================================================

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === "\t" || ch === ";") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

// العنوان (بأيّ صيغة) ← اسم الحقل
const HEADER_MAP: Record<string, string> = {
  date: "date", day: "date", "reporting starts": "date", "التاريخ": "date",
  entity_type: "entity_type",
  ad_external_id: "ad_external_id", "ad id": "ad_external_id",
  "ad set id": "adset_external_id", "campaign id": "adcampaign_external_id",
  campaign_code: "campaign_code", content_code: "content_code", activity_code: "activity_code", entity_id: "entity_id",
  spend: "spend", "amount spent (usd)": "spend_usd", "amount spent (iqd)": "spend", "amount spent": "spend",
  impressions: "impressions", reach: "reach",
  clicks: "clicks", "clicks (all)": "clicks", link_clicks: "link_clicks", "link clicks": "link_clicks",
  leads: "leads", "leads (form)": "leads", results: "leads",
  conversions: "conversions", video_views: "video_views", "3-second video plays": "video_views",
  engagements: "engagements", "post engagement": "engagements",
  likes: "likes", "post reactions": "likes", comments: "comments", "post comments": "comments",
  shares: "shares", "post shares": "shares", saves: "saves", "post saves": "saves",
  followers_gained: "followers_gained", visitors: "visitors", watch_seconds: "watch_seconds",
};

const NUMERIC = ["spend", "impressions", "reach", "clicks", "link_clicks", "leads", "conversions", "video_views",
  "engagements", "likes", "comments", "shares", "saves", "followers_gained", "visitors", "watch_seconds"];

export type MetricRow = Record<string, string | number>;

export function csvToMetricRows(text: string, opts: { usdRate: number; defaultEntityType?: string }): {
  rows: MetricRow[]; unknownHeaders: string[]; error: string | null;
} {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], unknownHeaders: [], error: "الملف فارغ أو بلا صفوف بيانات." };
  const headers = table[0].map((h) => h.trim().toLowerCase());
  const keys = headers.map((h) => HEADER_MAP[h] ?? null);
  const unknownHeaders = table[0].filter((_, i) => keys[i] === null).map((h) => h.trim()).filter(Boolean);
  if (!keys.includes("date")) return { rows: [], unknownHeaders, error: "لا عمود تاريخ (date أو Day)." };
  if (!keys.some((k) => k && ["ad_external_id", "campaign_code", "content_code", "activity_code", "entity_id"].includes(k))) {
    return { rows: [], unknownHeaders, error: "لا عمود يعرّف الكيان (Ad ID أو campaign_code أو content_code أو activity_code)." };
  }

  const rows: MetricRow[] = [];
  for (const line of table.slice(1)) {
    const r: MetricRow = {};
    keys.forEach((k, i) => {
      if (!k) return;
      const raw = (line[i] ?? "").trim();
      if (raw === "") return;
      if (k === "spend_usd") {
        const n = Number(raw.replace(/[,\s$]/g, ""));
        if (Number.isFinite(n)) r.spend = Math.round(n * opts.usdRate);
      } else if (NUMERIC.includes(k)) {
        const n = Number(raw.replace(/[,\s]/g, ""));
        if (Number.isFinite(n)) r[k] = n;
      } else if (k === "date") {
        r.date = raw.slice(0, 10);
      } else {
        r[k] = raw;
      }
    });
    if (!r.entity_type) r.entity_type = r.ad_external_id ? (opts.defaultEntityType ?? "إعلان") : "";
    if (r.entity_type === "") delete r.entity_type;
    rows.push(r);
  }
  return { rows, unknownHeaders, error: null };
}
