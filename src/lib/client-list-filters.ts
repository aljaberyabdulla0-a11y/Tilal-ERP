import { IRAQ_GOVERNORATES, PAYMENT_METHODS, PURCHASE_PURPOSES } from "@/lib/types";

// ============================================================
// مُرشِّحات قائمة العملاء — ملفّ واحد تقرأه الصفحة والتصدير.
//
// ===== لماذا ملفّ مشترك =====
//
// زرّ «تصدير اكسل» بجوار المُرشِّحات. فمن رشّح «متابعات متأخرة لدانيه»
// ثم صدّر يتوقّع ملفّ تلك القائمة — لا ملفّ الشركة كلها. ومنطقان
// منفصلان للصفحة والتصدير يفترقان مع أول مُرشِّح يُضاف لأحدهما.
//
// ===== القاعدة =====
//
// كل قيمة تصل من الرابط تُقبل فقط إن كانت في قائمتها المعروفة، وإلا
// تُتجاهل بصمت: رابطٌ قديم أو مُلفَّق لا يُظهر «لا نتائج» بلا سبب.
//
// ⚠️ هذا الملف نقيّ (بلا قاعدة ولا خادم) كي يُختبر. القوائم المسموحة
//    تُمرَّر إليه من الصفحة.
// ============================================================

export type ClientListSearchParams = {
  q?: string;
  owner?: string;
  stage?: string;
  source?: string;
  from?: string;
  to?: string;
  contact?: string;
  followup?: string;
  temperature?: string;
  tag?: string;
  payment?: string;
  purpose?: string;
  governorate?: string;
  area?: string;
  filter?: string;
  page?: string;
};

// ===== الخيارات الثابتة =====

// آخر تواصل. «أبداً» منفصل عن «صامت»: من لم يُكلَّم قطّ مشكلة غير من
// كُلِّم ثم نُسي — الأول ليدٌ لم يُستلم، والثاني علاقة تبرد.
export const CONTACT_OPTIONS = {
  never: "لم يُتواصل معه أبداً",
  recent: "تواصل خلال آخر ٧ أيام",
  over7: "آخر تواصل قبل أكثر من ٧ أيام",
  over14: "آخر تواصل قبل أكثر من ١٤ يوماً",
  over30: "آخر تواصل قبل أكثر من ٣٠ يوماً",
} as const;
export type ContactKey = keyof typeof CONTACT_OPTIONS;

export const FOLLOWUP_OPTIONS = {
  overdue: "متأخرة",
  today: "اليوم",
  week: "خلال ٧ أيام",
  none: "بلا متابعة",
} as const;
export type FollowupKey = keyof typeof FOLLOWUP_OPTIONS;

// بيانات ناقصة — تصل أيضاً من روابط «نظرة» و«الجودة» (§45)
export const QUALITY_OPTIONS = {
  no_phone: "بلا رقم هاتف",
  no_source: "بلا مصدر",
  no_budget: "بلا ميزانية",
  no_owner: "بلا مالك",
} as const;
export type QualityKey = keyof typeof QUALITY_OPTIONS;

export const NO_OWNER = "none";

// ===== ما يُمرَّر من الصفحة =====

export type ClientFilterContext = {
  stages: string[];
  sources: string[];
  owners: { id: string; full_name: string }[];
  tags: { id: string; name: string }[];
  temperatures: string[];
  /** اليوم بتوقيت بغداد YYYY-MM-DD */
  today: string;
};

export type ClientListFilters = {
  q: string | null;
  owner: string | null; // معرّف موظف أو NO_OWNER
  stage: string | null;
  source: string | null;
  from: string | null;
  to: string | null;
  contact: ContactKey | null;
  followup: FollowupKey | null;
  temperature: string | null;
  tag: string | null;
  payment: string | null;
  purpose: string | null;
  governorate: string | null;
  area: string | null;
  quality: QualityKey | null;
};

export type ParsedClientFilters = {
  filters: ClientListFilters;
  /** ما يُعاد بناء الرابط منه — للترقيم والعروض المحفوظة والتصدير */
  params: Record<string, string>;
  /** وصف عربي لكل مُرشِّح فعّال، ومفتاحه في الرابط كي يُزال وحده */
  chips: { key: keyof ClientListSearchParams; label: string }[];
  /** هل فُتح شيءٌ من «فلاتر إضافية»؟ فتبقى مفتوحة */
  secondaryActive: boolean;
};

// ===== أدوات صغيرة =====

function isDate(v: string | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

function oneOf<T extends string>(v: string | undefined, allowed: readonly T[]): T | null {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

// الرموز التي تكسر صيغة or() في PostgREST أو تصير أنماطاً في ilike
export function cleanText(v: string | undefined): string | null {
  const s = (v ?? "").trim().replace(/[%,()*\\]/g, "").slice(0, 80);
  return s || null;
}

export function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ============================================================
// القراءة من الرابط
// ============================================================
export function parseClientListFilters(
  sp: ClientListSearchParams,
  ctx: ClientFilterContext
): ParsedClientFilters {
  const owner =
    sp.owner === NO_OWNER ? NO_OWNER : oneOf(sp.owner, ctx.owners.map((o) => o.id));

  let from = isDate(sp.from) ? sp.from : null;
  let to = isDate(sp.to) ? sp.to : null;
  // مدى مقلوب: من كتب «من ١٠ إلى ١» قصد المدى بينهما
  if (from && to && from > to) [from, to] = [to, from];

  const filters: ClientListFilters = {
    q: cleanText(sp.q),
    owner,
    stage: oneOf(sp.stage, ctx.stages),
    source: oneOf(sp.source, ctx.sources),
    from,
    to,
    contact: oneOf(sp.contact, Object.keys(CONTACT_OPTIONS) as ContactKey[]),
    followup: oneOf(sp.followup, Object.keys(FOLLOWUP_OPTIONS) as FollowupKey[]),
    temperature: oneOf(sp.temperature, ctx.temperatures),
    tag: oneOf(sp.tag, ctx.tags.map((t) => t.id)),
    payment: oneOf(sp.payment, PAYMENT_METHODS),
    purpose: oneOf(sp.purpose, PURCHASE_PURPOSES),
    governorate: oneOf(sp.governorate, IRAQ_GOVERNORATES),
    area: cleanText(sp.area),
    quality: oneOf(sp.filter, Object.keys(QUALITY_OPTIONS) as QualityKey[]),
  };

  const params: Record<string, string> = {};
  const chips: ParsedClientFilters["chips"] = [];
  const put = (key: keyof ClientListSearchParams, value: string | null, label: string) => {
    if (!value) return;
    params[key] = value;
    chips.push({ key, label });
  };

  const f = filters;
  put("q", f.q, `بحث: ${f.q}`);
  put(
    "owner",
    f.owner,
    f.owner === NO_OWNER
      ? "بلا موظف"
      : `الموظف: ${ctx.owners.find((o) => o.id === f.owner)?.full_name ?? ""}`
  );
  put("stage", f.stage, `المرحلة: ${f.stage}`);
  put("source", f.source, `المصدر: ${f.source}`);
  put("from", f.from, `أُضيف من ${f.from}`);
  put("to", f.to, `أُضيف حتى ${f.to}`);
  put("contact", f.contact, f.contact ? CONTACT_OPTIONS[f.contact] : "");
  put("followup", f.followup, f.followup ? `المتابعة: ${FOLLOWUP_OPTIONS[f.followup]}` : "");
  put("temperature", f.temperature, `الحرارة: ${f.temperature}`);
  put("tag", f.tag, `وسم: ${ctx.tags.find((t) => t.id === f.tag)?.name ?? ""}`);
  put("payment", f.payment, `الدفع: ${f.payment}`);
  put("purpose", f.purpose, `الغرض: ${f.purpose}`);
  put("governorate", f.governorate, `المحافظة: ${f.governorate}`);
  put("area", f.area, `المنطقة: ${f.area}`);
  put("filter", f.quality, f.quality ? QUALITY_OPTIONS[f.quality] : "");

  const secondaryActive = !!(
    f.temperature || f.tag || f.payment || f.purpose || f.governorate || f.area || f.quality
  );

  return { filters, params, chips, secondaryActive };
}

// ============================================================
// التطبيق على استعلام Supabase
//
// ⚠️ `any` لأن نوع باني الاستعلام في Supabase يتغيّر مع كل سلسلة،
//    ولا يُكتب عاماً بلا ضجيج. الأعمدة مذكورة حرفياً هنا فقط.
//
// الوسم في جدول ثانٍ (client_tags)، فتُمرَّر معرّفات عملائه جاهزة.
// ============================================================
export function applyClientListFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  f: ClientListFilters,
  opts: { today: string; now: Date; tagClientIds?: string[] | null }
) {
  let q = query;

  // البحث يشمل جهة الاتصال البديلة: حين يتصل القريب أو مدير الأعمال
  // من رقمه هو، يجب أن يصل الموظف لملف العميل برقم المتصل.
  if (f.q) {
    q = q.or(
      `name.ilike.%${f.q}%,phone.ilike.%${f.q}%,` +
        `alt_contact_name.ilike.%${f.q}%,alt_contact_phone.ilike.%${f.q}%`
    );
  }

  if (f.owner === NO_OWNER) q = q.is("owner_id", null);
  else if (f.owner) q = q.eq("owner_id", f.owner);

  if (f.stage) q = q.eq("stage", f.stage);
  if (f.source) q = q.eq("source", f.source);

  // «تاريخ الإضافة» هو entry_date — التاريخ المعروض والمستورَد من
  // الإكسل، لا created_at الذي يساوي يوم الاستيراد للعملاء القدامى.
  if (f.from) q = q.gte("entry_date", f.from);
  if (f.to) q = q.lte("entry_date", f.to);

  if (f.contact) {
    const cutoff = (days: number) => new Date(opts.now.getTime() - days * 86400000).toISOString();
    switch (f.contact) {
      case "never":
        q = q.is("last_contact_at", null);
        break;
      case "recent":
        q = q.gte("last_contact_at", cutoff(7));
        break;
      case "over7":
        q = q.lt("last_contact_at", cutoff(7));
        break;
      case "over14":
        q = q.lt("last_contact_at", cutoff(14));
        break;
      case "over30":
        q = q.lt("last_contact_at", cutoff(30));
        break;
    }
  }

  if (f.followup) {
    switch (f.followup) {
      case "overdue":
        q = q.lt("follow_up_date", opts.today);
        break;
      case "today":
        q = q.eq("follow_up_date", opts.today);
        break;
      case "week":
        q = q.gte("follow_up_date", opts.today).lte("follow_up_date", addDays(opts.today, 7));
        break;
      case "none":
        q = q.is("follow_up_date", null);
        break;
    }
  }

  if (f.temperature) q = q.eq("lead_temperature", f.temperature);
  if (f.payment) q = q.eq("payment_method", f.payment);
  if (f.purpose) q = q.eq("purchase_purpose", f.purpose);
  if (f.governorate) q = q.eq("governorate", f.governorate);
  if (f.area) q = q.ilike("area", `%${f.area}%`);

  if (f.quality) {
    switch (f.quality) {
      case "no_phone":
        q = q.or("phone.is.null,phone.eq.");
        break;
      case "no_source":
        q = q.or("source.is.null,source.eq.");
        break;
      case "no_budget":
        q = q.is("budget_min", null).is("budget_max", null);
        break;
      case "no_owner":
        q = q.is("owner_id", null);
        break;
    }
  }

  if (f.tag) {
    const ids = opts.tagClientIds ?? [];
    // قائمة فارغة تعني «لا أحد» لا «الكل» — لذلك معرّف مستحيل
    q = q.in("id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }

  return q;
}
