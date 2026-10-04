// ============================================================
// تحليل الخسائر — النصوص بلغتين والصياغة. **بلا استيراد من الخادم**
// (مكوّنات العميل تستورد من هنا — انظر crm-style.ts لسبب الفصل).
//
// القيم المخزّنة رموزٌ ثابتة (price، high، negotiation…) والأسماء
// الظاهرة تأتي من القاعدة بلغتين (name_ar / name_en). ما هنا هو ما لا
// صفّ له في القاعدة: عناوين الشاشة، ومفاتيح الشرائح والنتائج، وصياغة
// الرؤى التلقائية من معاملاتها.
// ============================================================

export type Lang = "ar" | "en";

export function pick<T extends { name_ar?: string | null; name_en?: string | null }>(
  row: T | null | undefined,
  lang: Lang
): string {
  if (!row) return "—";
  return (lang === "en" ? row.name_en || row.name_ar : row.name_ar || row.name_en) ?? "—";
}

const AR = {
  pageTitle: "لماذا نخسر المبيعات؟",
  pageSubtitle: "ذكاء الخسائر — من «كم فرصة خسرنا» إلى «لماذا، وأين، وكم قيمتها، وما يُسترجع منها».",
  execTitle: "Lost Sales Intelligence",
  tab: "الخسائر",
  dialogTitle: "تحليل سبب فقدان فرصة البيع",
  dialogEditTitle: "تعديل تحليل الخسارة",
  dialogIntro: "لا تُغلق الفرصة قبل هذا التحليل. المرحلة والقيمة والمالك والمشروع والحملة تُسجَّل تلقائياً.",
  autoCaptured: "يُسجَّل تلقائياً",
  stageNow: "المرحلة التي تسقط منها",
  dealValue: "قيمة الصفقة",
  owner: "المسؤول",
  project: "المشروع",
  category: "الفئة الرئيسية لفقدان البيع",
  reason: "السبب",
  lossSource: "مصدر فقدان البيع",
  customerPotential: "جودة العميل",
  recovery: "إمكانية الاسترجاع",
  recontactRequired: "يلزم إعادة التواصل",
  recontactDate: "موعد إعادة التواصل",
  recoveryReason: "لماذا يمكن استرجاعه؟",
  details: "تفاصيل فقدان البيع",
  detailsHint: "ماذا حدث بالتفصيل — يُقرأ في التقارير بعد أشهر.",
  detailsRequired: "مطلوب: اشرح السبب (١٠ أحرف على الأقل).",
  discount: "الخصم المعروض (د.ع)",
  competitor: "المنافس",
  competitorSection: "تحليل المنافس",
  competitorPick: "اختر من القائمة",
  competitorOther: "منافس غير مدرج — اكتب اسمه",
  competitorProject: "مشروع المنافس",
  competitorPrice: "سعر المنافس (د.ع)",
  competitorPriceM2: "سعر المتر عند المنافس",
  competitorUnit: "مساحة وحدة المنافس (م²)",
  competitorPlan: "خطة دفع المنافس",
  competitorAdvantage: "ميزة المنافس",
  competitorChoice: "لماذا اختاره العميل",
  showCompetitor: "منافسٌ له علاقة بالخسارة",
  editReason: "سبب التعديل (يُحفظ في السجلّ)",
  lostValue: "القيمة الخاسرة (للمشرف)",
  choose: "— اختر —",
  save: "أغلق الفرصة كخاسرة",
  saveEdit: "احفظ التعديل",
  cancel: "إلغاء",
  saving: "جارٍ الحفظ…",
  required: "مطلوب",
  loading: "جارٍ التحميل…",
  loadError: "تعذّر تحميل القوائم — تأكّد من تشغيل الهجرة ١٤٠.",
  // التنشيط
  reactivate: "إعادة تنشيط الفرصة",
  reactivateIntro: "عاد العميل مهتماً؟ الخسارة السابقة تبقى بتاريخها وسببها، وتُحتسب الفرصة «مسترجعة» إن رُبحت.",
  reactivateStage: "المرحلة التي تعود إليها",
  reactivateNote: "لماذا عاد العميل؟",
  nextAction: "الخطوة القادمة",
  nextActionDate: "موعدها",
  reactivateSave: "أعد التنشيط",
  // المراجعة
  review: "مراجعة المشرف",
  confirm: "تأكيد التحليل",
  dispute: "اعتراض",
  reviewNote: "ملاحظة المراجعة",
  // تبويب الفرصة
  lostAnalysis: "تحليل الخسارة",
  overview: "نظرة",
  timeline: "التسلسل",
  lostDate: "تاريخ الخسارة",
  lostStage: "المرحلة التي خُسرت فيها",
  milestone: "أبعد نقطة بلغتها",
  lossNo: "الخسارة رقم",
  evidence: "الشواهد حتى الخسارة",
  contacts: "تواصل",
  meetings: "اجتماعات",
  visits: "زيارات",
  offers: "عروض أسعار",
  lastContact: "آخر تواصل",
  daysInPipeline: "أيام في خطّ المبيعات",
  expectedRevenue: "إيراد تلال المتوقّع",
  expectedCommission: "عمولة الموظف المتوقّعة",
  unitInfo: "الوحدة",
  pricePerM2: "سعر المتر",
  area: "المساحة",
  paymentPlan: "خطة الدفع",
  changes: "سجلّ التعديلات",
  noChanges: "لم يُعدَّل التحليل منذ كتابته.",
  edit: "تعديل",
  needsAnalysis: "خسارة قديمة بلا تحليل — أكمله الآن.",
  analyse: "أكمل التحليل",
  manager: "المشرف",
  lostBy: "سجّلها",
  reviewStatus: "المراجعة",
  // التقرير
  filters: "المُرشِّحات",
  apply: "طبّق",
  reset: "مسح",
  from: "من",
  to: "إلى",
  allProjects: "كل المشاريع",
  allEmployees: "كل الموظفين",
  allTeams: "كل الفرق",
  allSources: "كل المصادر",
  allCampaigns: "كل الحملات",
  allSizes: "كل المساحات",
  allBands: "كل شرائح السعر",
  allCategories: "كل الأسباب",
  allCompetitors: "كل المنافسين",
  employee: "الموظف",
  team: "الفريق",
  source: "مصدر الليد",
  campaign: "الحملة",
  unitSize: "مساحة الوحدة",
  priceBand: "شريحة السعر",
  categoryFilterNote: "مُرشِّحا السبب والمنافس يضيّقان الخسائر وحدها.",
  kTotal: "الفرص",
  kWon: "رابحة",
  kLost: "خاسرة",
  kOpen: "مفتوحة",
  kWinRate: "نسبة الفوز",
  kLostRate: "نسبة الخسارة",
  kWonValue: "قيمة الرابحة",
  kLostValue: "قيمة الخاسرة",
  kRecoverable: "القابلة للاسترجاع",
  kRecovered: "المسترجعة",
  kUnanalysed: "بلا تحليل",
  insights: "رؤى تلقائية",
  noInsights: "لا رؤى بعد — تظهر حين تكفي البيانات لاستنتاج لا تخمين.",
  topReasons: "أهمّ أسباب الخسارة",
  byCategory: "بالفئة",
  byReason: "أكثر الأسباب تكراراً",
  byLossSource: "مصدر المشكلة",
  byProject: "بالمشروع",
  byEmployee: "بموظف المبيعات",
  bySource: "بمصدر الليد",
  byCampaign: "بالحملة",
  byStage: "أين نخسر في القمع",
  byMilestone: "أبعد نقطة بلغتها الخاسرة",
  byPriceBand: "بشريحة السعر",
  byUnitSize: "بمساحة الوحدة",
  byCompetitor: "المنافسون",
  byPotential: "جودة العملاء الخاسرين",
  recoverableList: "فرص قابلة للاسترجاع",
  monthly: "الاتجاه الشهري",
  reasonTrend: "اتجاه الأسباب",
  count: "العدد",
  value: "القيمة",
  share: "الحصّة",
  mainReason: "السبب الأول",
  leads: "ليدات",
  qualified: "مؤهّلة",
  opportunities: "فرص",
  conversion: "التحويل",
  recoveryRate: "نسبة الاسترجاع",
  recoverable: "قابلة للاسترجاع",
  priceLost: "خسائر السعر",
  qualityLow: "جودة منخفضة",
  oppPerLead: "فرص لكل ١٠٠ ليد",
  priceDiffM2: "فرق سعر المتر",
  priceDiff: "فرق السعر",
  projectsLost: "مشاريع خسرناها أمامه",
  customer: "العميل",
  daysSinceLost: "منذ الخسارة",
  days: "يوماً",
  month: "الشهر",
  topProject: "المشروع الأول",
  topCompetitor: "المنافس الأول",
  empty: "لا بيانات بهذه المُرشِّحات.",
  unavailable: "تقرير الخسائر غير متاح — شغّل الهجرتين ١٤٠ و١٤١.",
  ratioNote: "لا يُحكم على موظف بعدد خسائره: النسب والقيم معاً.",
  valueEstimated: "منها مقدّرٌ من ميزانية العميل",
  unknown: "غير محدّد",
  noProject: "بلا مشروع",
  noOwner: "بلا مالك",
  // تاريخ العميل
  salesHistory: "تاريخ المبيعات",
  salesHistoryHint: "العميل لا يُعدّ «خاسراً» لأن صفقةً خسرت — لكل فرصة نتيجتها.",
  pastLossReasons: "أسباب الصفقات الخاسرة",
  // يومي
  recontactDue: "إعادة تواصل مع فرص خاسرة",
  recontactDueHint: "حدّدتَ موعدها عند تحليل الخسارة — قد تعود فرصةً رابحة.",
  open: "افتح",
  // الإعدادات
  settingsTitle: "إعدادات تحليل الخسارة",
  settingsIntro: "القوائم التي يختار منها الموظف عند إغلاق فرصة كخاسرة. الرموز ثابتة؛ الأسماء تُعدَّل بحرّية. لا حذف — التعطيل يخفي العنصر ويُبقي تاريخه.",
} as const;

export type LostDict = { [K in keyof typeof AR]: string };

const EN: LostDict = {
  pageTitle: "Why Are We Losing Sales?",
  pageSubtitle: "Lost sales intelligence — from “how many did we lose” to why, where, how much, and what can be recovered.",
  execTitle: "Lost Sales Intelligence",
  tab: "Lost Sales",
  dialogTitle: "Lost Sale Analysis",
  dialogEditTitle: "Edit Lost Analysis",
  dialogIntro: "The opportunity cannot be closed without this analysis. Stage, value, owner, project and campaign are captured automatically.",
  autoCaptured: "Captured automatically",
  stageNow: "Stage it is lost at",
  dealValue: "Deal value",
  owner: "Owner",
  project: "Project",
  category: "Failure category",
  reason: "Failure reason",
  lossSource: "Failure source",
  customerPotential: "Customer potential",
  recovery: "Recovery potential",
  recontactRequired: "Recontact required",
  recontactDate: "Recontact date",
  recoveryReason: "Why can it be recovered?",
  details: "Lost sale details",
  detailsHint: "What happened, in detail — read in reports months later.",
  detailsRequired: "Required: explain the reason (at least 10 characters).",
  discount: "Discount offered (IQD)",
  competitor: "Competitor",
  competitorSection: "Competitor analysis",
  competitorPick: "Pick from the list",
  competitorOther: "Competitor not listed — type the name",
  competitorProject: "Competitor project",
  competitorPrice: "Competitor price (IQD)",
  competitorPriceM2: "Competitor price per sqm",
  competitorUnit: "Competitor unit size (sqm)",
  competitorPlan: "Competitor payment plan",
  competitorAdvantage: "Competitor advantage",
  competitorChoice: "Why the customer chose them",
  showCompetitor: "A competitor was involved",
  editReason: "Reason for the edit (kept in the log)",
  lostValue: "Lost value (manager)",
  choose: "— Choose —",
  save: "Close as lost",
  saveEdit: "Save changes",
  cancel: "Cancel",
  saving: "Saving…",
  required: "Required",
  loading: "Loading…",
  loadError: "Could not load the lists — make sure migration 140 is applied.",
  reactivate: "Reactivate opportunity",
  reactivateIntro: "Customer interested again? The previous loss stays with its date and reason; if won, the deal counts as recovered.",
  reactivateStage: "Stage to return to",
  reactivateNote: "Why did the customer come back?",
  nextAction: "Next action",
  nextActionDate: "Due date",
  reactivateSave: "Reactivate",
  review: "Manager review",
  confirm: "Confirm analysis",
  dispute: "Dispute",
  reviewNote: "Review note",
  lostAnalysis: "Lost Analysis",
  overview: "Overview",
  timeline: "Timeline",
  lostDate: "Lost date",
  lostStage: "Lost at stage",
  milestone: "Furthest milestone",
  lossNo: "Loss #",
  evidence: "Evidence up to the loss",
  contacts: "Contacts",
  meetings: "Meetings",
  visits: "Visits",
  offers: "Offers",
  lastContact: "Last contact",
  daysInPipeline: "Days in pipeline",
  expectedRevenue: "Expected Tilal revenue",
  expectedCommission: "Expected employee commission",
  unitInfo: "Unit",
  pricePerM2: "Price per sqm",
  area: "Area",
  paymentPlan: "Payment plan",
  changes: "Change log",
  noChanges: "Not edited since it was written.",
  edit: "Edit",
  needsAnalysis: "Old loss without analysis — complete it now.",
  analyse: "Complete analysis",
  manager: "Manager",
  lostBy: "Recorded by",
  reviewStatus: "Review",
  filters: "Filters",
  apply: "Apply",
  reset: "Clear",
  from: "From",
  to: "To",
  allProjects: "All projects",
  allEmployees: "All employees",
  allTeams: "All teams",
  allSources: "All sources",
  allCampaigns: "All campaigns",
  allSizes: "All sizes",
  allBands: "All price ranges",
  allCategories: "All reasons",
  allCompetitors: "All competitors",
  employee: "Sales employee",
  team: "Sales team",
  source: "Lead source",
  campaign: "Campaign",
  unitSize: "Unit size",
  priceBand: "Price range",
  categoryFilterNote: "Reason and competitor filters narrow the lost set only.",
  kTotal: "Opportunities",
  kWon: "Won",
  kLost: "Lost",
  kOpen: "Open",
  kWinRate: "Win rate",
  kLostRate: "Lost rate",
  kWonValue: "Won value",
  kLostValue: "Lost value",
  kRecoverable: "Recoverable",
  kRecovered: "Recovered",
  kUnanalysed: "Not analysed",
  insights: "Automatic insights",
  noInsights: "No insights yet — they appear once the data supports a conclusion, not a guess.",
  topReasons: "Top reasons for lost sales",
  byCategory: "By category",
  byReason: "Most frequent reasons",
  byLossSource: "Failure source",
  byProject: "By project",
  byEmployee: "By sales employee",
  bySource: "By lead source",
  byCampaign: "By campaign",
  byStage: "Where we lose in the funnel",
  byMilestone: "Furthest milestone reached",
  byPriceBand: "By price range",
  byUnitSize: "By unit size",
  byCompetitor: "Competitors",
  byPotential: "Lost customer quality",
  recoverableList: "Recoverable opportunities",
  monthly: "Monthly trend",
  reasonTrend: "Reasons trend",
  count: "Count",
  value: "Value",
  share: "Share",
  mainReason: "Main reason",
  leads: "Leads",
  qualified: "Qualified",
  opportunities: "Opportunities",
  conversion: "Conversion",
  recoveryRate: "Recovery rate",
  recoverable: "Recoverable",
  priceLost: "Lost on price",
  qualityLow: "Low quality",
  oppPerLead: "Opps per 100 leads",
  priceDiffM2: "Price/sqm difference",
  priceDiff: "Price difference",
  projectsLost: "Projects lost against",
  customer: "Customer",
  daysSinceLost: "Since lost",
  days: "days",
  month: "Month",
  topProject: "Top project",
  topCompetitor: "Top competitor",
  empty: "No data for these filters.",
  unavailable: "Lost sales report unavailable — apply migrations 140 and 141.",
  ratioNote: "Never judge an employee by lost count alone: ratios and values together.",
  valueEstimated: "of which estimated from customer budget",
  unknown: "Unknown",
  noProject: "No project",
  noOwner: "No owner",
  salesHistory: "Sales History",
  salesHistoryHint: "A customer is not a “lost customer” because one deal was lost — each opportunity has its own outcome.",
  pastLossReasons: "Reasons for lost deals",
  recontactDue: "Recontact lost opportunities",
  recontactDueHint: "You set these dates in the lost analysis — they may come back as won deals.",
  open: "Open",
  settingsTitle: "Lost analysis settings",
  settingsIntro: "The lists employees choose from when closing an opportunity as lost. Codes are fixed; names are free to edit. No deletion — deactivating hides an item and keeps its history.",
};

export function lostDict(lang: Lang): LostDict {
  return lang === "en" ? EN : (AR as LostDict);
}

// ===== رموز ثابتة بلا صفّ في القاعدة =====

const MILESTONES: Record<string, [string, string]> = {
  new: ["ليد جديد", "New lead"],
  contacted: ["تم التواصل", "Contacted"],
  qualified: ["مؤهَّل", "Qualified"],
  meeting: ["اجتماع", "Meeting"],
  site_visit: ["زيارة موقع", "Site visit"],
  offer: ["عرض سعر", "Offer"],
  negotiation: ["تفاوض", "Negotiation"],
  reservation: ["حجز", "Reservation"],
  contract: ["عقد / مقدّمة", "Contract"],
  unknown: ["غير معروف", "Unknown"],
};

const BANDS: Record<string, [string, string]> = {
  lt200: ["أقل من ٢٠٠ مليون", "< 200M"],
  "200_300": ["٢٠٠ – ٣٠٠ مليون", "200M – 300M"],
  "300_500": ["٣٠٠ – ٥٠٠ مليون", "300M – 500M"],
  "500_750": ["٥٠٠ – ٧٥٠ مليون", "500M – 750M"],
  "750p": ["٧٥٠ مليون فأكثر", "750M+"],
  unknown: ["قيمة غير معروفة", "Unknown value"],
};
export const PRICE_BANDS = ["lt200", "200_300", "300_500", "500_750", "750p", "unknown"] as const;

const OUTCOMES: Record<string, [string, string, string]> = {
  lost: ["خاسرة", "Lost", "bg-red-100 text-red-700"],
  reactivated: ["أُعيد تنشيطها", "Reactivated", "bg-amber-100 text-amber-700"],
  recovered: ["استُرجعت", "Recovered", "bg-emerald-100 text-emerald-700"],
  relost: ["خُسرت مجدداً", "Lost again", "bg-red-100 text-red-800"],
};

const REVIEWS: Record<string, [string, string, string]> = {
  pending: ["بانتظار المراجعة", "Pending review", "bg-gray-100 text-gray-600"],
  confirmed: ["مؤكَّد", "Confirmed", "bg-emerald-100 text-emerald-700"],
  disputed: ["معترَض عليه", "Disputed", "bg-red-100 text-red-700"],
};

const BASES: Record<string, [string, string]> = {
  deal: ["من قيمة الصفقة", "from deal value"],
  unit: ["من سعر الوحدة", "from unit price"],
  budget: ["تقدير من ميزانية العميل", "estimated from budget"],
  manual: ["صحّحها المشرف", "corrected by manager"],
  none: ["غير معروفة", "unknown"],
};

const FIELDS: Record<string, [string, string]> = {
  category_id: ["الفئة", "Category"],
  reason_id: ["السبب", "Reason"],
  loss_source: ["مصدر الخسارة", "Failure source"],
  customer_potential: ["جودة العميل", "Customer potential"],
  recovery_potential: ["إمكانية الاسترجاع", "Recovery potential"],
  recontact_required: ["إعادة التواصل", "Recontact required"],
  recontact_date: ["موعد إعادة التواصل", "Recontact date"],
  recovery_reason: ["سبب الاسترجاع", "Recovery reason"],
  details: ["التفاصيل", "Details"],
  lost_value: ["القيمة الخاسرة", "Lost value"],
  value_basis: ["أساس القيمة", "Value basis"],
  discount: ["الخصم", "Discount"],
  competitor_id: ["المنافس", "Competitor"],
  competitor_project_id: ["مشروع المنافس", "Competitor project"],
  competitor_name: ["اسم المنافس", "Competitor name"],
  competitor_price: ["سعر المنافس", "Competitor price"],
  competitor_price_per_m2: ["سعر متر المنافس", "Competitor price/sqm"],
  competitor_unit_m2: ["مساحة وحدة المنافس", "Competitor unit size"],
  competitor_payment_plan: ["خطة دفع المنافس", "Competitor payment plan"],
  competitor_advantage: ["ميزة المنافس", "Competitor advantage"],
  competitor_choice_reason: ["سبب اختيار المنافس", "Why competitor chosen"],
  outcome: ["النتيجة", "Outcome"],
  review_status: ["المراجعة", "Review"],
  review_note: ["ملاحظة المراجعة", "Review note"],
  reactivation_note: ["سبب إعادة التنشيط", "Reactivation note"],
  recovered_value: ["القيمة المسترجعة", "Recovered value"],
  __deleted: ["حُذف التحليل", "Analysis deleted"],
};

function two(map: Record<string, [string, string] | [string, string, string]>, code: string | null | undefined, lang: Lang) {
  if (!code) return "—";
  const v = map[code];
  if (!v) return code;
  return lang === "en" ? v[1] : v[0];
}

export const milestoneLabel = (c: string | null | undefined, l: Lang) => two(MILESTONES, c, l);
export const bandLabel = (c: string | null | undefined, l: Lang) => two(BANDS, c, l);
export const outcomeLabel = (c: string | null | undefined, l: Lang) => two(OUTCOMES, c, l);
export const reviewLabel = (c: string | null | undefined, l: Lang) => two(REVIEWS, c, l);
export const basisLabel = (c: string | null | undefined, l: Lang) => two(BASES, c, l);
export const fieldLabel = (c: string | null | undefined, l: Lang) => two(FIELDS, c, l);
export const outcomeStyle = (c: string | null | undefined) => (c && OUTCOMES[c]?.[2]) || "bg-gray-100 text-gray-600";
export const reviewStyle = (c: string | null | undefined) => (c && REVIEWS[c]?.[2]) || "bg-gray-100 text-gray-600";

// ===== الأرقام =====

export function money(n: number | string | null | undefined, lang: Lang): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(lang === "en" ? "en-US" : "en-US", { maximumFractionDigits: 0 });
}

/** قيمة كبيرة مختصرة: 18.4B / ١٨٫٤ مليار */
export function compactMoney(n: number | string | null | undefined, lang: Lang): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const fmt1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-US");
  if (abs >= 1e9) return lang === "en" ? `${fmt1(v / 1e9)}B` : `${fmt1(v / 1e9)} مليار`;
  if (abs >= 1e6) return lang === "en" ? `${fmt1(v / 1e6)}M` : `${fmt1(v / 1e6)} مليون`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function pct(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `${v}%` : "—";
}

// ===== الرؤى التلقائية =====
//
// القاعدة تقرّر ما يستحقّ أن يُقال (العتبات في 141) وتُرجع رمزاً
// ومعاملات. هنا الصياغة وحدها — فلا يُحسب رقمٌ في الواجهة.

export type Insight = { code: string; level: "info" | "warn" | "risk"; params: Record<string, unknown> };
export type NameOf = (code: string | null | undefined) => string;

export function insightText(ins: Insight, lang: Lang, categoryName: NameOf): string {
  const p = ins.params as Record<string, any>;
  const en = lang === "en";
  switch (ins.code) {
    case "top_reason_30d":
      return en
        ? `${categoryName(p.code)} is the main reason for lost opportunities in the last 30 days (${p.share}% — ${p.n} of ${p.total}).`
        : `«${categoryName(p.code)}» هو السبب الرئيسي لفقدان فرص البيع خلال آخر ٣٠ يوماً (${p.share}% — ${p.n} من ${p.total}).`;
    case "project_lost_rate":
      return en
        ? `Project ${p.project} has a lost rate ${p.diff} points above the projects' average (${p.lost_rate}% vs ${p.avg}%).`
        : `مشروع «${p.project}» لديه نسبة خسارة أعلى من متوسط المشاريع بـ${p.diff} نقطة (${p.lost_rate}% مقابل ${p.avg}%).`;
    case "recoverable_in_top_reason":
      return en
        ? `${p.share}% of customers lost on ${categoryName(p.code)} have high recovery potential (${p.high} of ${p.n}).`
        : `${p.share}% من العملاء الذين خسرناهم بسبب «${categoryName(p.code)}» لديهم إمكانية استرجاع مرتفعة (${p.high} من ${p.n}).`;
    case "campaign_low_quality":
      return en
        ? `Campaign ${p.campaign} generates high lead volume (${p.leads}) but low quality: ${p.qualified_rate}% qualified vs ${p.avg}% average.`
        : `حملة «${p.campaign}» تجلب ليدات كثيرة (${p.leads}) بجودة منخفضة: ${p.qualified_rate}% مؤهّلة مقابل متوسط ${p.avg}%.`;
    case "competitor_impact":
      return en
        ? `Competitor ${p.name} caused ${p.n} lost opportunities with an estimated lost value of ${compactMoney(p.value, lang)} IQD.`
        : `المنافس «${p.name}» تسبّب في خسارة ${p.n} فرصة بقيمة تقديرية ${compactMoney(p.value, lang)} د.ع.`;
    case "reason_shift": {
      const up = Number(p.diff) > 0;
      return en
        ? `Losses due to ${categoryName(p.code)} ${up ? "increased" : "decreased"} by ${Math.abs(Number(p.diff))} points versus the previous month (${p.prev_share}% → ${p.cur_share}%).`
        : `الخسارة بسبب «${categoryName(p.code)}» ${up ? "ارتفعت" : "انخفضت"} ${Math.abs(Number(p.diff))} نقطة عن الشهر السابق (${p.prev_share}% ← ${p.cur_share}%).`;
    }
    case "employee_training":
      return en
        ? `${p.employee} may need coaching: lost rate ${p.lost_rate}% vs ${p.avg}% average over ${p.closed} closed deals${Number(p.sales_employee_lost) > 0 ? `, ${p.sales_employee_lost} losses attributed to the employee` : ""}.`
        : `«${p.employee}» قد يحتاج تدريباً: نسبة خسارته ${p.lost_rate}% مقابل متوسط ${p.avg}% على ${p.closed} صفقة مغلقة${Number(p.sales_employee_lost) > 0 ? `، منها ${p.sales_employee_lost} خسارة مصدرها الموظف` : ""}.`;
    case "unanalysed":
      return en
        ? `${p.n} lost opportunities (${p.share}%) have no analysis — reasons for these are unknown.`
        : `${p.n} فرصة خاسرة (${p.share}%) بلا تحليل — سبب خسارتها مجهول حتى يُكمَل.`;
    case "recontact_overdue":
      return en
        ? `${p.n} recoverable opportunities passed their recontact date without action (${compactMoney(p.value, lang)} IQD).`
        : `${p.n} فرصة قابلة للاسترجاع فات موعد إعادة التواصل معها بلا إجراء (${compactMoney(p.value, lang)} د.ع).`;
    case "unqualified_losses":
      return en
        ? `${p.share}% of analysed losses were not qualified opportunities (D) — a lead-quality issue, not a sales one.`
        : `${p.share}% من الخسائر المحلَّلة لم تكن فرصاً مؤهّلة (D) — مشكلة جودة ليدات لا مشكلة بيع.`;
    case "value_unknown":
      return en
        ? `${p.n} lost opportunities (${p.share}%) have no known value — lost value is understated.`
        : `${p.n} فرصة خاسرة (${p.share}%) بلا قيمة معروفة — القيمة الخاسرة أقلّ من حقيقتها.`;
    default:
      return ins.code;
  }
}

export const INSIGHT_STYLE: Record<string, string> = {
  risk: "border-red-200 bg-red-50 text-red-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-brand-200 bg-brand-50 text-brand-900",
};
