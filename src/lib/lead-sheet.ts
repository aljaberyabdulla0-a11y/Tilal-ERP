import { phoneKey } from "@/lib/clients-excel";

// ============================================================
// قراءة Lead Sheets (218) — منطق خالص بلا Supabase، يُختبر وحده.
//
// ملفّ Meta يأتي بعناوين إنجليزية (full_name, phone_number, campaign_name…)
// وقيمٍ مسبوقة بحرفين («p:+964…» للهاتف، «l:123…» للمعرّف، «c:…» للحملة)،
// وغالباً CSV بترميز UTF-16 وفواصل Tab. والملف اليدوي بعناوين عربية.
// فالمطابقة بالمرادفات تقترح، والمستخدم يقرّر قبل الحفظ.
// ============================================================

export const LEAD_FIELDS = [
  { key: "name", label: "الاسم" },
  { key: "first_name", label: "الاسم الأول" },
  { key: "last_name", label: "اسم العائلة" },
  { key: "phone", label: "الهاتف", required: true },
  { key: "email", label: "البريد" },
  { key: "campaign", label: "اسم الحملة" },
  { key: "campaign_code", label: "معرّف الحملة / رمزها" },
  { key: "ad", label: "الإعلان" },
  { key: "form", label: "الاستمارة" },
  { key: "platform", label: "المنصّة" },
  { key: "created_time", label: "وقت الاستلام" },
  { key: "external_id", label: "معرّف الليد" },
  { key: "message", label: "الرسالة / الملاحظة" },
] as const;

export type LeadFieldKey = (typeof LEAD_FIELDS)[number]["key"];
export type LeadMapping = Partial<Record<LeadFieldKey, number>>;

const SYNONYMS: Record<LeadFieldKey, string[]> = {
  name: ["full_name", "full name", "name", "الاسم", "اسم العميل", "الاسم الكامل", "الاسم الثلاثي"],
  first_name: ["first_name", "first name", "الاسم الأول"],
  last_name: ["last_name", "last name", "اسم العائلة", "اللقب"],
  phone: ["phone_number", "phone", "mobile", "phone number", "رقم الهاتف", "الهاتف", "الموبايل", "رقم الموبايل", "الرقم"],
  email: ["email", "e-mail", "البريد", "البريد الإلكتروني", "الايميل"],
  campaign: ["campaign_name", "campaign", "الحملة", "اسم الحملة"],
  campaign_code: ["campaign_id", "campaign code", "رمز الحملة", "معرف الحملة", "معرّف الحملة"],
  ad: ["ad_name", "ad", "الإعلان", "اسم الإعلان"],
  form: ["form_name", "form", "form_id", "الاستمارة", "النموذج"],
  platform: ["platform", "المنصة", "المنصّة", "القناة"],
  created_time: ["created_time", "created time", "date", "التاريخ", "وقت الاستلام", "تاريخ الاستلام"],
  external_id: ["id", "lead_id", "lead id", "معرف الليد", "معرّف الليد"],
  message: ["message", "notes", "note", "الرسالة", "ملاحظات", "ملاحظة", "الطلب"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[ً-ْ]/g, "").replace(/\s+/g, " ");

export function guessMapping(headers: string[]): LeadMapping {
  const out: LeadMapping = {};
  const taken = new Set<number>();
  for (const f of LEAD_FIELDS) {
    const wanted = SYNONYMS[f.key].map(norm);
    const idx = headers.findIndex((h, i) => !taken.has(i) && wanted.includes(norm(h)));
    if (idx >= 0) {
      out[f.key] = idx;
      taken.add(idx);
    }
  }
  return out;
}

// «p:+9647…» ⇒ «+9647…» — بادئات تصدير Meta
export function stripMetaPrefix(v: string): string {
  return v.replace(/^(p|l|c|as|ag|f|ad):/i, "").trim();
}

export type LeadSheetRow = {
  rowNumber: number;
  name: string;
  phone: string;
  email: string;
  campaign: string;
  campaign_code: string;
  ad: string;
  form: string;
  platform: string;
  created_time: string;
  external_id: string;
  message: string;
  phoneKey: string | null;
  // lead_import_rows يرى ليد Meta بمعرّفٍ رقمي طويل؛ الباقي مفتاح ملف
  metaId: string | null;
  issue: "رقم غير صالح" | "بلا رقم" | "مكرّر داخل الملف" | null;
};

const PLATFORMS: Record<string, string> = { fb: "facebook", ig: "instagram", facebook: "facebook", instagram: "instagram" };

export function mapRows(rows: string[][], mapping: LeadMapping, firstRowNumber = 2): LeadSheetRow[] {
  const get = (r: string[], k: LeadFieldKey) => {
    const i = mapping[k];
    return i === undefined ? "" : String(r[i] ?? "").trim();
  };
  const seen = new Set<string>();
  const out: LeadSheetRow[] = [];
  rows.forEach((r, i) => {
    if (r.every((c) => !String(c ?? "").trim())) return;
    const first = get(r, "first_name");
    const last = get(r, "last_name");
    const name = get(r, "name") || [first, last].filter(Boolean).join(" ");
    const phone = stripMetaPrefix(get(r, "phone"));
    const external = stripMetaPrefix(get(r, "external_id"));
    const campaignCode = stripMetaPrefix(get(r, "campaign_code"));
    const platformRaw = get(r, "platform").toLowerCase();
    const key = phoneKey(phone);
    const metaId = /^\d{8,}$/.test(external) ? external : null;
    const campaign = get(r, "campaign");

    let issue: LeadSheetRow["issue"] = null;
    if (!phone) issue = "بلا رقم";
    else if (!key) issue = "رقم غير صالح";
    const dupKey = metaId ? `m:${metaId}` : key ? `p:${key}|${campaign || campaignCode}` : null;
    if (!issue && dupKey) {
      if (seen.has(dupKey)) issue = "مكرّر داخل الملف";
      seen.add(dupKey);
    }

    out.push({
      rowNumber: firstRowNumber + i,
      name,
      phone,
      email: get(r, "email"),
      campaign,
      campaign_code: campaignCode,
      ad: get(r, "ad"),
      form: get(r, "form"),
      platform: PLATFORMS[platformRaw] ?? platformRaw,
      created_time: get(r, "created_time"),
      external_id: external,
      message: get(r, "message"),
      phoneKey: key,
      metaId,
      issue,
    });
  });
  return out;
}

// ما يُرسل لـ lead_import_rows. الرقم غير الصالح يُرسل عمداً: يُسجَّل في
// الدفتر «مرفوضاً» فيظهر في قائمة الأخطاء بدل أن يبقى في الملف وحده.
// المكرّر داخل الملف لا يُرسل — نسخةٌ من صفٍّ أُرسل.
export function toImportPayload(r: LeadSheetRow) {
  return {
    name: r.name || null,
    phone: r.phone || null,
    email: r.email || null,
    campaign: r.campaign || null,
    campaign_code: r.campaign_code || null,
    ad: r.ad || null,
    form: r.form || null,
    platform: r.platform || null,
    created_time: r.created_time || null,
    external_id: r.external_id || null,
    message: r.message || null,
  };
}

// ===== CSV =====
// Meta: UTF-16LE بعلامة BOM وفواصل Tab. Excel العربي: UTF-8 وأحياناً «؛».
export function decodeCsv(buf: Uint8Array): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  const s = new TextDecoder("utf-8").decode(buf);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length);
  const counts = [["\t", 0], [",", 0], [";", 0], ["؛", 0]] as [string, number][];
  for (const c of counts) c[1] = firstLine.split(c[0]).length - 1;
  const sep = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
