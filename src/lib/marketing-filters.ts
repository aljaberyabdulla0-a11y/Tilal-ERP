// ============================================================
// مُرشِّحات التسويق — من الرابط إلى معاملات دوالّ 125.
//
// منطقٌ خالص بلا خادم (يُختبر في marketing-filters.test.ts). والمفردات
// نفسها في الرابط وفي معاملات القاعدة: from · to · project · campaign
// · channel · model — كما وحّد §44 مفردات الـCRM، فلا يسقط مُرشِّح بين
// لوحتين.
//
// «اليوم» يُمرَّر من الخارج (baghdadDate) — الدالّة لا تقرأ الساعة،
// فيُختبر حدُّ الشهر والسنة بلا انتظار.
// ============================================================

export type MktPreset = "month" | "last30" | "quarter" | "year" | "last90" | "all" | "custom";

export const PRESET_LABELS: Record<Exclude<MktPreset, "custom">, string> = {
  month: "هذا الشهر",
  last30: "آخر ٣٠ يوماً",
  quarter: "هذا الربع",
  last90: "آخر ٩٠ يوماً",
  year: "هذه السنة",
  all: "كل الوقت",
};

export type MktFilters = {
  preset: MktPreset;
  from: string | null;
  to: string | null;
  project: string | null;
  campaign: string | null;
  channel: string | null;
  model: string;
  /** ما يُحمَل في الروابط — المُرشِّحات المضبوطة وحدها */
  params: Record<string, string>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MODELS = ["last", "first", "linear", "position", "time_decay", "campaign"];

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function presetRange(preset: MktPreset, today: string): { from: string | null; to: string | null } {
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "quarter": {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: `${y}-${String(qm).padStart(2, "0")}-01`, to: today };
    }
    case "year":
      return { from: `${y}-01-01`, to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "last90":
      return { from: addDays(today, -89), to: today };
    case "all":
      return { from: null, to: null };
    default:
      return { from: null, to: null };
  }
}

/** الفترة السابقة بنفس الطول، ملاصقةً لما قبلها — للمقارنة في اللوحة التنفيذية */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const len = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

export function parseMktFilters(
  sp: Record<string, string | string[] | undefined>,
  today: string,
  defaultPreset: MktPreset = "month"
): MktFilters {
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v.trim() : Array.isArray(v) ? (v[0] ?? "").trim() : "";
  };
  const id = (k: string) => (UUID.test(one(k)) ? one(k) : null);

  let from: string | null = DATE.test(one("from")) ? one("from") : null;
  let to: string | null = DATE.test(one("to")) ? one("to") : null;
  let preset: MktPreset;

  // الصريح يغلب: من كتب تاريخين قصدهما
  if (from || to) {
    preset = "custom";
    if (from && to && from > to) [from, to] = [to, from];
  } else {
    const p = one("range") as MktPreset;
    preset = p in PRESET_LABELS ? p : defaultPreset;
    ({ from, to } = presetRange(preset, today));
  }

  const model = MODELS.includes(one("model")) ? one("model") : "last";
  const project = id("project");
  const campaign = id("campaign");
  const channel = id("channel");

  const params: Record<string, string> = {};
  if (preset === "custom") {
    if (from) params.from = from;
    if (to) params.to = to;
  } else if (preset !== defaultPreset) {
    params.range = preset;
  }
  if (project) params.project = project;
  if (campaign) params.campaign = campaign;
  if (channel) params.channel = channel;
  if (model !== "last") params.model = model;

  return { preset, from, to, project, campaign, channel, model, params };
}

export function withParams(base: string, params: Record<string, string>, patch: Record<string, string | null> = {}): string {
  const q = new URLSearchParams(params);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return `${base}${s ? `?${s}` : ""}`;
}
