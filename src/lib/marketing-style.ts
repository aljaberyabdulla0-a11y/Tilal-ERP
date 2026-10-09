// ============================================================
// ثوابت قسم التسويق — **بلا أي استيراد من الخادم** (مثل crm-style).
//
// كل قائمة هنا مرآةٌ لقيد CHECK في sql/121–126. اختلافهما صامت:
// خيارٌ في القائمة لا يقبله القيد يُظهر «فشل الحفظ» بلا تفسير،
// وقيمةٌ في القيد لا تظهر هنا لا يختارها أحد. والمرايا مغطّاة في
// marketing-style.test.ts الذي يقرأ ملفّات SQL نفسها.
// ============================================================

export const CAMPAIGN_STATUSES = [
  "مسودة", "تخطيط", "بانتظار الموافقة", "معتمدة", "نشطة", "متوقفة", "مكتملة", "ملغاة",
] as const;

export const CAMPAIGN_TYPES = [
  "توعية", "توليد ليدات", "تحويل", "إعادة استهداف", "إطلاق", "إطلاق مشروع", "تحديث مشروع",
  "علامة تجارية", "مستثمرون", "فعالية", "موسمية", "مؤثرون", "ميداني", "هجينة",
] as const;

export const CAMPAIGN_MODES = ["رقمي", "ميداني", "هجين"] as const;

export const CONTENT_TYPES = [
  "منشور", "ريلز", "فيديو", "ستوري", "كاروسيل", "تصميم ثابت", "مدونة", "مقال", "نص موقع",
  "صفحة هبوط", "بريد", "رسالة نصية", "واتساب", "بروشور", "لوحة إعلانية", "بيان صحفي",
  "دراسة حالة", "تحديث مشروع", "فيديو مبيعات", "فيديو تعليمي", "محتوى مستثمرين",
] as const;

// مسار الإنتاج بالترتيب — اللوحة تعرض الأعمدة بهذا الترتيب
export const CONTENT_STATUSES = [
  "فكرة", "مسودة", "كتابة", "تصميم", "مونتاج", "بانتظار الموافقة", "معتمد", "مجدول",
  "منشور", "مرفوض", "مؤرشف",
] as const;

// ما يملك الفريق نقله بيده — الباقي بالموافقة أو بيد مدير التسويق
export const CONTENT_FREE_STATUSES = ["فكرة", "مسودة", "كتابة", "تصميم", "مونتاج", "مؤرشف"] as const;

export const ACTIVITY_KINDS = [
  "لوحة إعلانية", "إعلان طرق", "مول", "معرض", "معرض عقاري", "فعالية", "تجهيز مركز المبيعات",
  "بانرات", "أعلام", "بروشورات", "فلايرات", "بطاقات عمل", "إعلان مطبوع", "مجلة", "صحيفة",
  "راديو", "تلفزيون", "تغليف مركبات", "تفعيل ميداني", "تفعيل شارع", "لافتات المشروع",
  "تجهيز موقع البناء", "لافتات إرشادية", "هدايا ترويجية",
] as const;

export const EVENT_KINDS = ["معرض", "معرض عقاري", "فعالية"] as const;

export const ACTIVITY_STATUSES = [
  "مخطط", "بانتظار الموافقة", "معتمد", "قيد التنفيذ", "نشط", "منتهٍ", "ملغى",
] as const;

export const DEAL_STAGES = [
  "بحث", "قائمة مختصرة", "تواصل", "تفاوض", "معتمد", "عقد", "محتوى", "منشور", "نتائج",
  "دفع", "تقييم", "ملغى",
] as const;

export const EXPENSE_CATEGORIES = [
  "إعلانات ميتا", "إعلانات جوجل", "إعلانات تيك توك", "إعلانات سناب شات", "إعلانات أخرى",
  "مؤثرون", "طباعة", "لوحات إعلانية", "فعاليات ومعارض", "أجنحة", "وكالات", "إنتاج", "تصوير",
  "فيديو", "برمجيات واشتراكات", "استضافة", "عروض ترويجية", "هدايا ترويجية", "نقل",
  "إعلام تقليدي", "أخرى",
] as const;

export const EXPENSE_STATUSES = ["مسودة", "بانتظار الموافقة", "معتمد", "مدفوع", "مرفوض", "ملغى"] as const;

export const ARMS = ["التسويق", "العقارات", "إداري عام"] as const;

export const PLAN_KINDS = [
  "استراتيجية سنوية", "استراتيجية ربعية", "استراتيجية شهرية", "خطة سنوية", "خطة ربعية",
  "خطة شهرية", "خطة أسبوعية", "خطة حملة", "خطة مشروع", "خطة قناة",
] as const;

export const OBJECTIVE_KINDS = ["هدف استراتيجي", "هدف", "مؤشر", "مبادرة", "أولوية"] as const;

// المقاييس التي يحسبها mkt_kpis — «الفعلي» لا يُكتب باليد
export const METRIC_LABELS: Record<string, string> = {
  leads: "ليدات",
  qualified: "مؤهَّلون",
  reservations: "حجوزات",
  sales: "بيعات",
  commission: "عمولة تلال",
  sale_value: "قيمة المبيعات",
  spend: "الكلفة",
  cpl: "كلفة الليد",
  cpql: "كلفة المؤهَّل",
  cpa: "كلفة الحجز",
  cac: "كلفة الاستحواذ",
  roi: "العائد ٪",
  roas: "عائد الإعلان",
  lead_to_sale: "ليد ← بيع ٪",
  lead_to_reservation: "ليد ← حجز ٪",
};

export const MKT_ROLES = [
  "مدير التسويق", "أخصائي تسويق", "مدير حساب", "كاتب محتوى", "مصمّم", "مصوّر", "مونتير",
  "مشتري إعلانات", "مدير منصّات", "أخصائي SEO", "مسوّق أداء", "منسّق فعاليات", "منسّق تسويق",
] as const;

export const ASSET_TYPES = [
  "صورة", "فيديو", "تصميم ثلاثي الأبعاد", "مخطط", "شعار", "دليل الهوية", "بروشور", "PDF",
  "عرض تقديمي", "مستند", "تصميم سوشيال", "إعلان", "صورة مشروع", "صورة إنشاء", "عقد", "فاتورة",
] as const;

export const DESTINATION_KINDS = [
  "صفحة هبوط", "مشروع", "وحدة", "واتساب", "اتصال", "بروشور", "نموذج ليد", "حملة", "رابط خارجي",
] as const;

export const TASK_STATUSES = ["للتنفيذ", "قيد التنفيذ", "مراجعة", "معطّلة", "منجزة"] as const;
export const TASK_PRIORITIES = ["عاجلة", "متوسطة", "عادية"] as const;

export const AD_LEVELS = ["حملة إعلانية", "مجموعة إعلانية", "إعلان"] as const;
export const AD_STATUSES = ["مسودة", "نشط", "متوقف", "منتهٍ"] as const;

export const ACCOUNT_KINDS = ["حساب تواصل", "حساب إعلانات", "موقع", "واتساب", "بريد", "رسائل"] as const;

export const BUDGET_PERIODS = ["سنوي", "ربعي", "شهري"] as const;
export const BUDGET_SCOPES = ["شركة", "مشروع", "حملة", "قناة", "نشاط"] as const;

export const PURCHASE_STATUSES = ["مسودة", "بانتظار الموافقة", "معتمد", "تم الشراء", "مرفوض", "ملغى"] as const;

export const MANUAL_TOUCH_TYPES = ["حضور فعالية", "إحالة", "مؤثر", "يدوي"] as const;

/** سعر الدولار الرسمي — مرآة DEFAULT_USD_RATE في marketing-sync */
export const DEFAULT_USD_RATE = 1520;

export const INTEGRATION_PROVIDERS: Record<string, { label: string; ready: boolean }> = {
  meta: { label: "Meta (فيسبوك وإنستغرام)", ready: true },
  google_ads: { label: "Google Ads", ready: false },
  tiktok: { label: "TikTok Ads", ready: false },
  linkedin: { label: "LinkedIn Ads", ready: false },
  youtube: { label: "YouTube", ready: false },
  google_analytics: { label: "Google Analytics", ready: false },
  gtm: { label: "Google Tag Manager", ready: false },
  whatsapp: { label: "واتساب", ready: false },
  email: { label: "البريد", ready: false },
  sms: { label: "الرسائل النصية", ready: false },
};

export const ATTRIBUTION_MODELS: Record<string, string> = {
  last: "آخر لمسة",
  first: "أول لمسة",
  linear: "خطّي",
  position: "موضعي ٤٠/٢٠/٤٠",
  time_decay: "متناقص بالزمن",
  campaign: "حملة العميل",
};

export const BREAKDOWN_DIMS: Record<string, string> = {
  campaign: "الحملة",
  channel: "القناة",
  project: "المشروع",
  activity: "النشاط الميداني",
  influencer: "المؤثر",
  content: "المحتوى",
  landing: "صفحة الهبوط",
  vendor: "المورّد",
  category: "تصنيف المصروف",
  employee: "الموظف (صاحب الحملة)",
  month: "الشهر",
};

// لون الشارة بمعنى الحالة لا باسمها: ما ينتظر قراراً أصفر، وما يعمل
// أخضر، وما انتهى رمادي، وما رُفض أحمر.
const TONE: Record<string, string> = {
  wait: "bg-amber-100 text-amber-800",
  live: "bg-brand-100 text-brand-700",
  ok: "bg-blue-100 text-blue-700",
  done: "bg-gray-100 text-gray-600",
  bad: "bg-red-100 text-red-700",
  draft: "bg-slate-100 text-slate-600",
};

const STATUS_TONE: Record<string, keyof typeof TONE> = {
  "بانتظار الموافقة": "wait", "معلّق": "wait", "مراجعة": "wait", "تفاوض": "wait",
  "نشطة": "live", "نشط": "live", "منشور": "live", "منشورة": "live", "مدفوع": "live", "قيد التنفيذ": "live",
  "متصل": "live", "موافق": "live",
  "معتمدة": "ok", "معتمد": "ok", "مجدول": "ok", "عقد": "ok", "تم الشراء": "ok",
  "مكتملة": "done", "منتهٍ": "done", "مؤرشف": "done", "مؤرشفة": "done", "منجزة": "done", "مغلقة": "done",
  "ملغاة": "bad", "ملغى": "bad", "مرفوض": "bad", "معطّلة": "bad", "خطأ": "bad", "متوقفة": "bad", "متوقف": "bad",
};

export function statusClass(status: string | null | undefined): string {
  return TONE[STATUS_TONE[status ?? ""] ?? "draft"];
}

export function fmt(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fmtPct(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  return `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

// الرابط العام لرمز تتبّع — يُبنى في مكان واحد (QR والنسخ والطباعة)
export function trackingUrl(origin: string, code: string, qr = false): string {
  return `${origin.replace(/\/$/, "")}/r/${code}${qr ? "?q=1" : ""}`;
}
