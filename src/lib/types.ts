// أنواع البيانات المشتركة في النظام

import { baghdadTime } from "@/lib/time";

// العميل (CRM) — يطابق أعمدة جدول clients في قاعدة البيانات
export type Client = {
  id: string;
  created_at: string;
  created_by: string | null;
  name: string;
  phone: string | null;
  governorate: string | null;   // المحافظة
  area: string | null;          // المنطقة
  purchase_purpose: string | null; // الغرض من الشراء
  // جهة اتصال بديلة تنوب عن العميل (اختيارية بالكامل) — sql/038
  alt_contact_name: string | null;
  alt_contact_phone: string | null;
  alt_contact_relation: string | null;
  source: string | null;        // مصدر العميل
  payment_method: string | null; // طريقة الدفع
  sales_employee: string | null; // موظف المبيعات
  entry_date: string | null;    // التاريخ (YYYY-MM-DD)
  notes: string | null;
  stage?: string;               // مرحلة المبيعات (Pipeline)
  follow_up_date?: string | null; // تاريخ المتابعة
  last_contact_at?: string | null; // آخر تواصل (يُحدَّث تلقائياً من سجلّ الأنشطة)
  contact_count?: number;          // عدد مرات التواصل
  // الوساطة (sql/043): الشركة صاحبة الليد ومهلتها ومشروعه
  broker_company_id?: string | null;
  project_id?: string | null;
  broker_assigned_at?: string | null;
  broker_deadline?: string | null;  // آخر يوم قبل العودة لتلال
  returned_at?: string | null;      // متى عاد لتلال
  returned_from?: string | null;    // من أي شركة عاد
  // مرتبط
  broker_companies?: { name: string } | null;
  projects?: { name: string } | null;
};

// ===== سجلّ التواصل مع العميل =====

export type ClientActivity = {
  id: string;
  client_id: string;
  created_at: string;
  created_by: string | null;
  activity_type: string;
  direction: string | null;
  outcome: string | null;
  occurred_at: string;
  duration_min: number | null;
  summary: string | null;
  next_action: string | null;
  next_action_date: string | null;
  stage_from: string | null;
  stage_to: string | null;
  actor_name: string | null;
  // مرتبط (عند عرض السجلّ العام)
  clients?: { name: string; phone: string | null; stage?: string | null } | null;
};

export type ActivityTypeMeta = {
  key: string;
  icon: string;      // Material Symbols
  color: string;     // ألوان الشارة والأيقونة
  hasDirection?: boolean;  // صادر/وارد
  hasDuration?: boolean;   // مدة بالدقائق
};

// أنواع التواصل — الترتيب هو ترتيب أزرار التسجيل السريع
export const ACTIVITY_TYPES: ActivityTypeMeta[] = [
  { key: "مكالمة", icon: "call", color: "bg-blue-100 text-blue-700", hasDirection: true, hasDuration: true },
  { key: "واتساب", icon: "chat", color: "bg-green-100 text-green-700", hasDirection: true },
  { key: "اجتماع", icon: "groups", color: "bg-purple-100 text-purple-700", hasDuration: true },
  { key: "زيارة", icon: "location_on", color: "bg-amber-100 text-amber-700", hasDuration: true },
  { key: "عرض سعر", icon: "request_quote", color: "bg-teal-100 text-teal-700" },
  { key: "ملاحظة", icon: "sticky_note_2", color: "bg-gray-100 text-gray-600" },
];

// أنواع يُنشئها النظام تلقائياً ولا تظهر في أزرار التسجيل — لأنها
// ليست تواصلاً مع العميل بل أحداثاً في ملفّه (sql/045).
export const STAGE_CHANGE_TYPE: ActivityTypeMeta = {
  key: "تغيير مرحلة",
  icon: "swap_horiz",
  color: "bg-indigo-100 text-indigo-700",
};

export const HANDOVER_TYPE: ActivityTypeMeta = {
  key: "تسليم",
  icon: "swap_horiz",
  color: "bg-indigo-100 text-indigo-700",
};

export const SYSTEM_ACTIVITY_TYPES = [STAGE_CHANGE_TYPE, HANDOVER_TYPE];

/**
 * حدثٌ كتبه النظام لا تواصلٌ قام به موظف — لا يُحتسب في عدّاد
 * الاتصالات. يقابلها في القاعدة public.is_system_activity() (sql/045)،
 * وأي نوع نظامي جديد يُضاف في الموضعين.
 */
export function isSystemActivity(type: string): boolean {
  return SYSTEM_ACTIVITY_TYPES.some((t) => t.key === type);
}

export function activityMeta(type: string): ActivityTypeMeta {
  const sys = SYSTEM_ACTIVITY_TYPES.find((t) => t.key === type);
  if (sys) return sys;
  return (
    ACTIVITY_TYPES.find((t) => t.key === type) ?? {
      key: type,
      icon: "bolt",
      color: "bg-gray-100 text-gray-600",
    }
  );
}

export const ACTIVITY_DIRECTIONS = ["صادر", "وارد"] as const;

// نتيجة التواصل — تساعد على معرفة جودة المتابعة
export const ACTIVITY_OUTCOMES = [
  "تم التواصل",
  "لم يرد",
  "مهتم",
  "غير مهتم",
  "مؤجل",
  "تم الاتفاق",
] as const;

export const ACTIVITY_OUTCOME_COLORS: Record<string, string> = {
  "تم التواصل": "bg-blue-100 text-blue-700",
  "لم يرد": "bg-gray-200 text-gray-600",
  "مهتم": "bg-green-100 text-green-700",
  "غير مهتم": "bg-red-100 text-red-700",
  "مؤجل": "bg-amber-100 text-amber-700",
  "تم الاتفاق": "bg-emerald-100 text-emerald-700",
};

// "قبل ٣ أيام" — منذ متى لم نتواصل مع هذا العميل
export function sinceLabel(ts: string | null | undefined): string {
  if (!ts) return "لا يوجد تواصل";
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (days <= 0) return "اليوم";
  if (days === 1) return "أمس";
  if (days < 30) return `قبل ${days} يوم`;
  const months = Math.floor(days / 30);
  return months === 1 ? "قبل شهر" : `قبل ${months} أشهر`;
}

// لون تحذيري كلّما طال انقطاع التواصل
export function sinceColor(ts: string | null | undefined): string {
  if (!ts) return "text-red-600";
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (days <= 7) return "text-green-700";
  if (days <= 21) return "text-amber-600";
  return "text-red-600";
}

// مراحل خطّ المبيعات (Sales Pipeline)
export const PIPELINE_STAGES = [
  "ليد",
  "اتصال",
  "زيارة",
  "مناقشة العرض",
  "بيع",
  "فشل البيع",
] as const;

// المراحل المغلقة — انتهى الملف عندها (بيع أو فشل)، فلا حاجة
// لخطوة قادمة ولا موعد متابعة.
export const CLOSED_STAGES = ["بيع", "فشل البيع"] as const;

export function isClosedStage(stage: string | null | undefined): boolean {
  return (CLOSED_STAGES as readonly string[]).includes(stage ?? "ليد");
}

// ألوان رأس كل مرحلة (Tailwind)
// مفتاح مقارنة الأسماء — يطابق `public.name_key` في القاعدة (sql/032).
// ⚠️ لا تغيّر أحدهما بلا الآخر: القاعدة تقرّر من يرى العميل، وهذه
// تقرّر تحت أي موظف تُعرض ليداته. اختلافهما يعني شاشة تكذب.
export function nameKey(txt: string | null | undefined): string {
  return (txt ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export const PIPELINE_STAGE_COLORS: Record<string, string> = {
  "ليد": "bg-gray-100 text-gray-700",
  "اتصال": "bg-blue-100 text-blue-700",
  "زيارة": "bg-purple-100 text-purple-700",
  "مناقشة العرض": "bg-amber-100 text-amber-700",
  "بيع": "bg-green-100 text-green-700",
  "فشل البيع": "bg-red-100 text-red-700",
};

// محافظات العراق (18)
export const IRAQ_GOVERNORATES = [
  "بغداد",
  "البصرة",
  "نينوى",
  "أربيل",
  "السليمانية",
  "دهوك",
  "كركوك",
  "صلاح الدين",
  "الأنبار",
  "ديالى",
  "واسط",
  "بابل",
  "كربلاء",
  "النجف",
  "القادسية (الديوانية)",
  "المثنى",
  "ميسان",
  "ذي قار",
] as const;

// الغرض من الشراء
export const PURCHASE_PURPOSES = ["سكن", "استثمار"] as const;

// صفة من ينوب عن العميل في التواصل
export const ALT_CONTACT_RELATIONS = [
  "قريب",
  "زوج / زوجة",
  "مدير أعمال",
  "وكيل",
  "صديق",
  "أخرى",
] as const;

// هل لهذا العميل جهة اتصال بديلة أصلاً؟
export function hasAltContact(
  c: Pick<Client, "alt_contact_name" | "alt_contact_phone">
): boolean {
  return Boolean(c.alt_contact_name?.trim() || c.alt_contact_phone?.trim());
}

// مصدر العميل
export const CLIENT_SOURCES = [
  "سوشيل ميديا",
  "صديق أو معارف",
  "مرّ من المنطقة",
  "مكتب عقاري",
] as const;

// طريقة الدفع
export const PAYMENT_METHODS = ["أقساط", "كاش", "نص كاش", "قرض عقاري"] as const;

// ألوان شارة طريقة الدفع (Tailwind) — للعرض في القائمة
export const PAYMENT_METHOD_COLORS: Record<string, string> = {
  "أقساط": "bg-amber-100 text-amber-700",
  "كاش": "bg-green-100 text-green-700",
  "نص كاش": "bg-teal-100 text-teal-700",
  "قرض عقاري": "bg-blue-100 text-blue-700",
};

// ===== الوحدات العقارية =====

export type Unit = {
  id: string;
  created_at: string;
  created_by: string | null;
  project: string;          // اسم المشروع — يملؤه محفّز القاعدة من project_id
  project_id: string | null; // المشروع الحقيقي، وعليه تُبنى الرؤية (sql/037)
  unit_code: string | null; // رقم/كود الوحدة
  unit_type: string;        // نوع الوحدة
  governorate: string | null; // المحافظة
  area: string | null;      // المنطقة
  space_m2: number | null;  // المساحة (م²)
  rooms: number | null;     // عدد الغرف
  price: number | null;     // السعر
  status: string;           // الحالة
  notes: string | null;
  // ===== مخزون المشاريع (sql/044) =====
  node_id: string | null;        // موقعها في هيكل المشروع
  node_path: string | null;      // «برج A / الطابق 01» — تحسبه القاعدة
  bathrooms: number | null;
  land_area_m2: number | null;
  built_area_m2: number | null;
  floors_count: number | null;
  parking_spaces: number | null;
  price_per_m2: number | null;   // محسوب في القاعدة
  payment_plan: string | null;
  blocked_reason: string | null; // سبب الإيقاف — يُمسح تلقائياً عند رفعه
  sold_at: string | null;
  attrs: Record<string, string | number | boolean | null>;
};

// أنواع الوحدات — القائمة الحيّة في جدول unit_types بالقاعدة.
// هذه نسخة احتياطية للنماذج القديمة فقط.
export const UNIT_TYPES = ["شقة", "أرض", "دار", "فيلا", "محل تجاري"] as const;

// حالات الوحدة
export const UNIT_STATUSES = ["متاحة", "محجوزة", "مباعة", "موقوفة"] as const;

// ألوان شارة الحالة (Tailwind)
export const UNIT_STATUS_COLORS: Record<string, string> = {
  "متاحة": "bg-green-100 text-green-700",
  "محجوزة": "bg-amber-100 text-amber-700",
  "مباعة": "bg-red-100 text-red-700",
  "موقوفة": "bg-gray-200 text-gray-600",
};

// تنسيق السعر بفواصل الآلاف (مثال: 150000 → 150,000)
export function formatPrice(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US");
}

// ===== الحجوزات (ربط عميل بوحدة) =====

export type Reservation = {
  id: string;
  created_at: string;
  created_by: string | null;
  client_id: string;
  unit_id: string;
  reservation_date: string | null; // تاريخ الحجز
  status: string;                   // حالة الحجز
  amount: number | null;            // المبلغ المدفوع
  notes: string | null;
  // ===== مخزون المشاريع (sql/044) =====
  expiry_date: string | null;       // نهاية مهلة الحجز
  expiry_notified_at: string | null; // نُبّه على انتهائها (مرة واحدة)
  agent_id: string | null;          // الموظف المسؤول عن الصفقة
  agent_name: string | null;
  created_by_name: string | null;   // من سجّل الحجز فعلاً
  // ===== طلب تحويل الحجز إلى بيع (sql/050) =====
  // الموظف يرفع الطلب والإدارة تُمضيه — لأن البيع يُصدر فاتورة
  // ويعترف بالإيراد ويستحقّ عمولة، فليس تغيير حالة في شاشة.
  sale_request_status: SaleRequestStatus | null;
  sale_requested_at: string | null;
  sale_requested_by: string | null;
  sale_request_note: string | null;
  sale_decided_at: string | null;
  sale_decided_by: string | null;
  sale_reject_reason: string | null;
  // ===== المقدمة — نقطة استحقاق العمولة الوحيدة (sql/056) =====
  // ⚠️ العربون (amount) معلومة متابعة بلا قيد: يذهب للمطوّر ولا
  // يمرّ بصندوق تلال. أمّا تأكيد المقدمة فهو ما يُنشئ القيود.
  down_payment_amount: number | null;
  down_payment_confirmed_at: string | null;
  down_payment_confirmed_by: string | null;
  commission_accrual_entry_id: string | null; // مدين 1250 / دائن 4200
  commission_collect_entry_id: string | null; // مدين 1100 / دائن 1250
  // بيانات مرتبطة (تأتي من الربط مع الجداول الأخرى)
  clients?: { name: string } | null;
  units?: { project: string; unit_code: string | null } | null;
};

// حالة طلب البيع — فارغة تعني «لا طلب على هذا الحجز»
export type SaleRequestStatus = "معلّق" | "مقبول" | "مرفوض";

export const SALE_REQUEST_COLORS: Record<string, string> = {
  "معلّق": "bg-blue-100 text-blue-700",
  "مقبول": "bg-green-100 text-green-700",
  "مرفوض": "bg-red-100 text-red-700",
};

// طلبٌ ينتظر قراراً — يظهر للإدارة في شاشة الحجوزات
export function salePending(r: {
  status: string;
  sale_request_status: string | null;
}): boolean {
  return r.status === "حجز" && r.sale_request_status === "معلّق";
}

// صاحب الصفقة: من سجّل الحجز أو المسؤول عنه — وهو وحده من يطلب
// بيعها. تطابق `can_request_unit_sale()` في القاعدة (sql/050)،
// فلا يظهر زرٌّ ترفضه القاعدة عند الضغط.
export function ownsReservation(
  r: Pick<Reservation, "created_by" | "agent_id">,
  userId: string | null | undefined,
  employeeId: string | null | undefined
): boolean {
  return Boolean(
    (userId && r.created_by === userId) ||
      (employeeId && r.agent_id === employeeId)
  );
}

// الحجز انتهت مهلته ولم يُقفل — يحتاج قراراً: تمديد أو إلغاء
export function reservationExpired(r: { status: string; expiry_date: string | null }): boolean {
  if (r.status !== "حجز" || !r.expiry_date) return false;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" });
  return r.expiry_date < today;
}

// حالات الحجز
export const RESERVATION_STATUSES = ["حجز", "بيع مكتمل", "ملغى"] as const;

// ألوان شارة حالة الحجز (Tailwind)
export const RESERVATION_STATUS_COLORS: Record<string, string> = {
  "حجز": "bg-amber-100 text-amber-700",
  "بيع مكتمل": "bg-green-100 text-green-700",
  "ملغى": "bg-red-100 text-red-700",
};

// ===== المحاسبة الاحترافية (القيد المزدوج) =====

// أنواع الحسابات الخمسة المعيارية
export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "الأصول",
  liability: "الالتزامات",
  equity: "حقوق الملكية",
  revenue: "الإيرادات",
  expense: "المصروفات",
};

// ترتيب عرض المجموعات في التقارير
export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
];

// طبيعة الرصيد: الأصول والمصروفات رصيدها مدين، والباقي دائن
export function isDebitNormal(type: string): boolean {
  return type === "asset" || type === "expense";
}

export type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  is_active: boolean;
  created_at: string;
};

export type JournalLine = {
  id: string;
  entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  line_note: string | null;
  // مرتبط (من الربط)
  accounts?: { code: string; name: string; type: string } | null;
};

export type JournalEntry = {
  id: string;
  created_at: string;
  created_by: string | null;
  entry_date: string;
  description: string;
  reference: string | null;
  // مرتبط (من الربط)
  journal_lines?: JournalLine[];
};

// قوالب العمليات الشائعة — تولّد القيد المتوازن تلقائياً
// debit = كود الحساب المدين | credit = كود الحساب الدائن
export type EntryTemplate = {
  key: string;
  label: string;
  debit: string;
  credit: string;
};

export const ENTRY_TEMPLATES: EntryTemplate[] = [
  { key: "sale_cash", label: "بيع وحدة نقداً", debit: "1100", credit: "4100" },
  { key: "sale_bank", label: "بيع وحدة عبر البنك", debit: "1200", credit: "4100" },
  { key: "sale_credit", label: "بيع آجل (على حساب العميل)", debit: "1300", credit: "4100" },
  { key: "collect_cash", label: "تحصيل دفعة من عميل (نقد)", debit: "1100", credit: "1300" },
  { key: "deposit_hold", label: "قبض عربون حجز (نقد)", debit: "1100", credit: "2400" },
  { key: "commission_income", label: "قبض عمولة (نقد)", debit: "1100", credit: "4200" },
  { key: "pay_salary", label: "دفع راتب (نقد)", debit: "5100", credit: "1100" },
  { key: "pay_rent", label: "دفع إيجار (نقد)", debit: "5200", credit: "1100" },
  { key: "daily_expense", label: "مصروف يومي (نقد)", debit: "5300", credit: "1100" },
  { key: "pay_utilities", label: "دفع فاتورة خدمات (نقد)", debit: "5400", credit: "1100" },
  { key: "pay_commission", label: "دفع عمولة (نقد)", debit: "5500", credit: "1100" },
  { key: "marketing", label: "مصروف تسويق وإعلان (نقد)", debit: "5700", credit: "1100" },
  { key: "deposit_bank", label: "إيداع نقد في البنك", debit: "1200", credit: "1100" },
  { key: "capital", label: "إدخال رأس المال (نقد)", debit: "1100", credit: "3100" },
];

// ===== الموارد البشرية (HR) =====

export type Employee = {
  id: string;
  user_id: string | null;
  full_name: string;
  job_title: string | null;
  department: string | null;
  phone: string | null;
  hire_date: string | null;
  base_salary: number;
  status: string; // active | inactive
  // نسبة عمولة خاصة بهذا الموظف — فارغة = يتبع نسبة الشركة (sql/046)
  commission_rate: number | null;
  // نهاية الخدمة — الموظف يبقى في الجدول لأن رواتبه وعمولاته
  // تاريخ لا يُمحى (sql/045)
  end_date: string | null;
  end_reason: string | null;
  notes: string | null;
  created_at: string;
  // المشروع الذي يعمل عليه — عليه يُبنى نطاق المشرف (sql/037)
  project_id: string | null;
  // الإدارة معفاة من البصمة — لا يُحتسب عليها غياب
  exempt_from_attendance: boolean;
  // دوام خاص بهذا الموظف (فارغ = يتبع دوام الشركة العام)
  work_start_time: string | null;
  work_end_time: string | null;
  work_days: number[] | null;
};

// موقع عمل تُقبل البصمة منه — يمكن أن تكون هناك عدة مواقع
export type WorkLocation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  is_active: boolean;
  created_at: string;
};

export type Attendance = {
  id: string;
  employee_id: string;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  note: string | null;
  // الموقع الجغرافي وقت البصمة (تحقّق النطاق)
  check_in_lat: number | null;
  check_in_lng: number | null;
  check_in_distance_m: number | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  check_out_distance_m: number | null;
  // اسم موقع العمل الذي تمّت البصمة عنده (عند تعدّد المواقع)
  check_in_location: string | null;
  check_out_location: string | null;
  source: string | null; // بصمة ذاتية | تسجيل يدوي بواسطة المدير
};

// الملاحظة التي يكتبها النظام حين يسجّل الانصراف بدل الموظف الذي نسيه.
// نفس النص مكتوب في sql/033_auto_checkout.sql — لا تغيّره في مكان واحد فقط.
export const AUTO_CHECKOUT_NOTE = "انصراف تلقائي";

export function isAutoCheckout(record: Attendance | null | undefined): boolean {
  return !!record?.check_out && !!record.note?.includes(AUTO_CHECKOUT_NOTE);
}

// إعدادات الشركة — موقع مركز المبيعات ونطاق البصمة المسموح
export type CompanySettings = {
  id: number;
  office_name: string;
  office_lat: number | null;
  office_lng: number | null;
  geofence_radius_m: number;
  geofence_enabled: boolean;
  updated_at: string;
  // أوقات الدوام الرسمية — تُحسب منها حالات التأخير والغياب
  work_start_time: string;      // "09:00:00"
  work_end_time: string;        // "17:00:00"
  late_grace_minutes: number;   // سماح قبل احتساب التأخير
  work_days: number[];          // 0=الأحد ... 6=السبت
  // ===== ضوابط التكامل (sql/046) =====
  // نسبة عمولة الموظف من قيمة الفاتورة. صفر = لا عمولة تلقائية.
  commission_rate: number;
  // مفاتيح الأتمتة: تُطفأ حين يحتاج المدير إدخالاً استثنائياً بيده
  auto_invoice_on_sale: boolean;
  auto_commission_on_paid: boolean;
};

// المسافة بالمتر بين نقطتين (نفس معادلة Haversine المستخدمة في قاعدة البيانات)
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

// عرض المسافة بصيغة مقروءة
export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} متر` : `${(m / 1000).toFixed(2)} كم`;
}

export type Leave = {
  id: string;
  employee_id: string;
  leave_type: string;
  duration_type: string; // يوم كامل | ساعات
  start_date: string;
  end_date: string;
  start_time: string | null; // للإجازة الزمنية فقط (HH:MM:SS)
  end_time: string | null;
  days: number | null;
  hours: number | null; // عدد الساعات للإجازة الزمنية
  reason: string | null;
  status: string; // معلقة | موافق عليها | مرفوضة
  created_at: string;
  employees?: { full_name: string } | null;
};

export type Commission = {
  id: string;
  employee_id: string;
  amount: number;
  comm_date: string;
  description: string | null;
  journal_entry_id: string | null; // القيد المحاسبي المرتبط (تكامل تلقائي)
  payroll_id: string | null; // الكشف الذي ضمّها (يمنع احتسابها مرتين)
  // الفاتورة التي استحقّت عنها — فريدة، فلا تتكرّر العمولة (sql/046)
  invoice_id: string | null;
  auto: boolean;             // أنشأها النظام لا موظف بيده
  // ===== متى تصير قابلة للدفع (sql/056) =====
  // فارغ = استُحقّت للموظف ولم تقبض تلال عمولتها من المطوّر بعد،
  // فلا تدخل كشف راتب. «لا أدفع عمولة من جيبي على مال لم يصلني».
  payable_at: string | null;
};

// حالة العمولة كما تُعرض: استُحقّت ثم صارت قابلة للدفع ثم دخلت كشفاً
export function commissionStage(c: Pick<Commission, "payable_at" | "payroll_id">) {
  if (c.payroll_id)
    return { label: "في كشف الراتب", color: "bg-green-100 text-green-700" };
  if (c.payable_at)
    return { label: "جاهزة للكشف القادم", color: "bg-blue-100 text-blue-700" };
  return {
    label: "مستحقّة — بانتظار تحصيل الشركة",
    color: "bg-amber-100 text-amber-700",
  };
}

export type Deduction = {
  id: string;
  employee_id: string;
  amount: number;
  ded_date: string;
  reason: string | null;
  payroll_id: string | null; // الكشف الذي ضمّه
  // من سجّل الخصم — يُختم داخل القاعدة فلا يُزوَّر (sql/041)
  created_by: string | null;
  created_by_name: string | null;
};

// أسباب الخصم الشائعة — قائمة مقترحة والحقل يقبل غيرها كتابةً
export const DEDUCTION_REASONS = [
  "تأخير",
  "غياب",
  "خروج مبكر",
  "مخالفة إدارية",
  "سلفة",
  "أخرى",
] as const;

export type Payroll = {
  id: string;
  employee_id: string;
  period: string;
  basic: number;
  allowances: number;
  commissions_total: number;
  deductions_total: number;
  net: number;
  status: string; // غير مدفوع | مدفوع جزئياً | مدفوع (تتحدّث تلقائياً من الدفعات)
  created_at: string;
  journal_entry_id: string | null; // قيد الاستحقاق المرتبط (تكامل تلقائي)
  // ===== دورة العمل (sql/051) =====
  // ⚠️ محورٌ آخر غير status: ذاك حالة الدفع وهذا حالة الاعتماد.
  // كشفٌ «معتمد» قد يكون «مدفوعاً جزئياً» في الوقت نفسه.
  state: PayrollState;
  approved_at: string | null;
  approved_by: string | null;
  locked_at: string | null;
};

// ============================================================
// كشف الراتب بنوداً (sql/051).
//
// الأعمدة الأربعة أعلاه (basic, allowances, …) لم تعد تُكتب
// باليد — تُحسب من هذه البنود بمحفّز في القاعدة. البند يقول من
// أين جاء كل دينار: أساسيٌّ من ملفّ الموظف، أو عمولة من صفقة،
// أو خصمٌ سجّله فلان.
// ============================================================
export type PayrollLine = {
  id: string;
  payroll_id: string;
  kind: "استحقاق" | "استقطاع";
  category: string;
  description: string | null;
  amount: number;
  source_table: string | null;
  source_id: string | null;
  manual: boolean;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
};

export const PAYROLL_EARNING_CATEGORIES = [
  "بدل",
  "مكافأة",
  "عمل إضافي",
  "استحقاق آخر",
] as const;

export const PAYROLL_DEDUCTION_CATEGORIES = [
  "غياب",
  "تأخير",
  "انصراف مبكر",
  "إجازة بلا راتب",
  "استقطاع آخر",
] as const;

// ============================================================
// خصم الدوام (sql/060) — يُحسب في القاعدة ويُعرض هنا.
//
// ⚠️ لا حساب في المتصفّح: هذه الأنواع تصف ما تُرجعه
// attendance_deductions()، وهي نفسها التي يستعملها build_payroll —
// فما تراه المعاينة هو بعينه ما يُكتب في الكشف.
// ============================================================
export type AttendanceDeduction = {
  work_date: string;
  category: "غياب" | "تأخير" | "انصراف مبكر";
  description: string;
  amount: number;
  minutes: number | null;
  source_id: string;
};

export type AttendanceExemption = {
  id: string;
  employee_id: string;
  exempt_date: string;
  exempt_type: "يوم كامل" | "فترة";
  start_time: string | null;
  end_time: string | null;
  reason: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
};

export const EXEMPT_TYPES = ["يوم كامل", "فترة"] as const;

// شرح كل نوع — الفرق بينهما مالي لا شكلي
export const EXEMPT_TYPE_HINTS: Record<string, string> = {
  "يوم كامل": "خارج المكتب طول اليوم — لا غياب ولا تأخير، ولا يُشترط أن يبصم.",
  "فترة": "خرج أو تأخّر بإذن ثم داوم — يُعفى من الدقائق لا من البصمة.",
};

export type EmployeeSalaryRecord = {
  id: string;
  employee_id: string;
  amount: number;
  effective_from: string;
  reason: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
};

// معاملات خصم الدوام في إعدادات الشركة
export type AttendanceRules = {
  attendance_rules_enabled: boolean;
  attendance_effective_date: string | null;
  late_grace_minutes: number;
  late_hour_factor: number;
  late_absent_threshold_minutes: number;
  absence_deduction_days: number;
  late_daily_cap_days: number;
  early_leave_as_late: boolean;
};

export type PayrollState = "مسودة" | "معتمد" | "مقفل";

export const PAYROLL_STATE_COLORS: Record<string, string> = {
  "مسودة": "bg-blue-100 text-blue-700",
  "معتمد": "bg-green-100 text-green-700",
  "مقفل": "bg-gray-200 text-gray-600",
};

// شرحٌ لكل حالة — يظهر تلميحاً على الشارة فيعرف من يقرأ ما تعنيه
export const PAYROLL_STATE_HINTS: Record<string, string> = {
  "مسودة": "لم يدخل الدفاتر بعد — يُعاد حسابه وتُعدَّل بنوده بحرّية.",
  "معتمد": "دخل دفاتر الشركة وتجمّدت أرقامه. يُعاد فتحه ما لم يُدفع منه شيء.",
  "مقفل": "مغلق نهائياً — لا يُعدَّل ولا يُعاد فتحه.",
};

// أيقونة كل نوع بند — تُقرأ القسيمة بالنظر لا بالقراءة
export const PAYROLL_LINE_ICONS: Record<string, string> = {
  "راتب أساسي": "account_balance_wallet",
  "بدل": "add_card",
  "عمولة": "percent",
  "مكافأة": "military_tech",
  "عمل إضافي": "more_time",
  "استحقاق آخر": "add_circle",
  "غياب": "event_busy",
  "تأخير": "schedule",
  "إجازة بلا راتب": "beach_access",
  "قسط سلفة": "credit_score",
  "سلفة": "payments",
  "استقطاع آخر": "remove_circle",
};

// مجموع بنود جهة واحدة
export function sumLines(
  lines: PayrollLine[],
  kind: "استحقاق" | "استقطاع"
): number {
  return lines
    .filter((l) => l.kind === kind)
    .reduce((s, l) => s + Number(l.amount), 0);
}

// دفعة راتب — تسمح بالدفع كاملاً أو على أجزاء
export type PayrollPayment = {
  id: string;
  created_at: string;
  payroll_id: string;
  pay_date: string;
  amount: number;
  method: "نقد" | "بنك";
  notes: string | null;
  journal_entry_id: string | null;
};

// حالة صرف الراتب تُشتق من مجموع الدفعات مقابل الصافي
export function payrollPayStatus(net: number, paid: number) {
  const remaining = Math.max(net - paid, 0);
  if (net <= 0) return { label: "—", color: "bg-gray-100 text-gray-500", remaining: 0 };
  if (paid >= net - 0.01)
    return { label: "مدفوع", color: "bg-green-100 text-green-700", remaining: 0 };
  if (paid > 0)
    return { label: "مدفوع جزئياً", color: "bg-amber-100 text-amber-700", remaining };
  return { label: "غير مدفوع", color: "bg-red-100 text-red-700", remaining };
}

export const LEAVE_TYPES = ["سنوية", "مرضية", "طارئة", "بدون راتب"] as const;
export const LEAVE_STATUSES = ["معلقة", "موافق عليها", "مرفوضة"] as const;

// مدّة الإجازة: يوم كامل (أو أكثر) — أو إجازة زمنية بالساعات داخل يوم واحد
export const LEAVE_DURATION_TYPES = ["يوم كامل", "ساعات"] as const;
export type LeaveDurationType = (typeof LEAVE_DURATION_TYPES)[number];

export const LEAVE_STATUS_COLORS: Record<string, string> = {
  "معلقة": "bg-amber-100 text-amber-700",
  "موافق عليها": "bg-green-100 text-green-700",
  "مرفوضة": "bg-red-100 text-red-700",
};

// عدد الأيام بين تاريخين (شامل الطرفين)
export function daysBetween(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  return diff > 0 ? diff : 0;
}

// عدد الساعات بين وقتين في نفس اليوم ("HH:MM")
export function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some(Number.isNaN)) return 0;
  const minutes = eh * 60 + em - (sh * 60 + sm);
  return minutes > 0 ? Math.round((minutes / 60) * 100) / 100 : 0;
}

// "09:00:00" → "09:00"
export function shortTime(t: string | null): string {
  return t ? t.slice(0, 5) : "—";
}

// عرض الساعات بلغة مفهومة: 2.5 → "ساعتان و30 دقيقة"
export function formatHours(h: number | null): string {
  if (h === null || h === undefined || h <= 0) return "—";
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  const hourPart =
    whole === 0 ? "" : whole === 1 ? "ساعة" : whole === 2 ? "ساعتان" : `${whole} ساعات`;
  const minPart = mins === 0 ? "" : `${mins} دقيقة`;
  if (hourPart && minPart) return `${hourPart} و${minPart}`;
  return hourPart || minPart;
}

// مدّة الإجازة كنص مختصر (للجداول)
export function formatLeaveDuration(l: Leave): string {
  if (l.duration_type === "ساعات") return formatHours(l.hours);
  const d = l.days ?? 0;
  return d === 1 ? "يوم واحد" : d === 2 ? "يومان" : `${d} أيام`;
}

// فترة الإجازة كنص مختصر (للجداول)
export function formatLeavePeriod(l: Leave): string {
  if (l.duration_type === "ساعات")
    return `${l.start_date} · ${shortTime(l.start_time)} ← ${shortTime(l.end_time)}`;
  return `${l.start_date} ← ${l.end_date}`;
}

// ===== الإشعارات =====
// اسم النوع AppNotification حتى لا يتعارض مع Notification المدمج في المتصفح
export type AppNotification = {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  link: string | null;
  kind: string; // إجازة | عام
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
};

// أيقونة Material Symbols حسب نوع الإشعار
export const NOTIFICATION_ICONS: Record<string, string> = {
  "إجازة": "beach_access",
  "متابعة": "phone_callback",
  "تصعيد": "priority_high",
  "رسالة": "chat_bubble",
  "مهمة": "task_alt",
  "مخزون": "inventory_2",
  "راتب": "payments",
  "تسليم": "swap_horiz",
  "بيع": "handshake",
  "عام": "notifications",
};

// "قبل 5 دقائق" — عرض زمن الإشعار بلغة بسيطة
export function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `قبل ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `قبل ${days} يوم`;
  return new Date(ts).toLocaleDateString("ar");
}

// تنسيق وقت (ساعة:دقيقة) من طابع زمني — **بتوقيت بغداد دائماً**
// (الطوابع محفوظة UTC وخادم Vercel يعمل بـ UTC، فبدون تحديد المنطقة
//  تظهر البصمة ناقصة ٣ ساعات)
export function formatTime(ts: string | null): string {
  if (!ts) return "—";
  return baghdadTime(ts);
}

// ===== الفواتير والمدفوعات =====

export type Payment = {
  id: string;
  created_at: string;
  invoice_id: string;
  amount: number;
  payment_date: string | null;
  method: string | null;
  note: string | null;
  journal_entry_id: string | null; // القيد المحاسبي المرتبط (تكامل تلقائي)
};

export type Invoice = {
  id: string;
  created_at: string;
  created_by: string | null;
  invoice_number: string;
  client_id: string;
  reservation_id: string | null;
  // الوحدة عمود ثابت لا يُشتقّ من الحجز، فيبقى الأثر لو حُذف
  // الحجز — تملؤه القاعدة من الحجز عند الإنشاء (sql/044).
  unit_id: string | null;
  issue_date: string | null;
  due_date: string | null;
  total_amount: number;
  notes: string | null;
  // مرتبط
  clients?: { name: string } | null;
  payments?: { amount: number }[];
};

export const INVOICE_PAYMENT_METHODS = ["نقد", "تحويل بنكي", "صك", "بطاقة"] as const;

// حالة الفاتورة محسوبة من مجموع المدفوعات
export function invoiceStatus(
  total: number,
  paid: number
): { label: string; color: string } {
  const remaining = total - paid;
  if (paid <= 0) return { label: "غير مدفوعة", color: "bg-red-100 text-red-700" };
  if (remaining <= 0) return { label: "مدفوعة", color: "bg-green-100 text-green-700" };
  return { label: "مدفوعة جزئياً", color: "bg-amber-100 text-amber-700" };
}

// ===== الديون الخارجية (سلف نعطيها ونستحصلها) =====
// ليست مصروفاً: الفلوس ما راحت، انتقلت من الصندوق إلى ذمّة شخص.
// حسابها 1350 مستقل تماماً عن حسابات المصاريف. انظر sql/035.

export const DEBT_PERSON_KINDS = [
  "مقاول",
  "وسيط",
  "مورّد",
  "موظف",
  "جهة أخرى",
] as const;

export type ExternalDebt = {
  id: string;
  created_at: string;
  created_by: string | null;
  person_name: string;
  person_phone: string | null;
  person_kind: string;
  amount: number;
  debt_date: string;
  due_date: string | null;   // موعد الاستحصال المتوقّع
  method: "نقد" | "بنك";
  reason: string | null;
  notes: string | null;
  journal_entry_id: string | null;
};

export type DebtRepayment = {
  id: string;
  created_at: string;
  created_by: string | null;
  debt_id: string;
  pay_date: string;
  amount: number;
  method: "نقد" | "بنك";
  note: string | null;
  journal_entry_id: string | null;
};

export function debtStatus(
  amount: number,
  collected: number
): { label: string; color: string; remaining: number } {
  const remaining = Math.max(amount - collected, 0);
  if (collected >= amount - 0.01)
    return { label: "مُستحصَل", color: "bg-green-100 text-green-700", remaining: 0 };
  if (collected > 0)
    return { label: "استُحصل جزئياً", color: "bg-amber-100 text-amber-700", remaining };
  return { label: "لم يُستحصَل", color: "bg-red-100 text-red-700", remaining };
}

// متأخر = فات موعد الاستحصال وما زال عليه متبقٍّ
export function isDebtOverdue(
  debt: Pick<ExternalDebt, "due_date">,
  remaining: number,
  today: string
): boolean {
  return remaining > 0.009 && !!debt.due_date && debt.due_date < today;
}

// ===== المشاريع والفرق =====
// المشروع هو وحدة التقسيم: له مشرف مسؤول، وموظفون يعملون عليه.
// مشروع بلا مشرف = مشترك يراه الجميع. انظر sql/037.

export const PROJECT_STATUSES = ["نشط", "مكتمل", "متوقف"] as const;

export const PROJECT_STATUS_COLORS: Record<string, string> = {
  "نشط": "bg-green-100 text-green-700",
  "مكتمل": "bg-blue-100 text-blue-700",
  "متوقف": "bg-gray-100 text-gray-600",
};

export type Project = {
  id: string;
  created_at: string;
  name: string;
  governorate: string | null;
  area: string | null;
  status: string;
  supervisor_id: string | null;
  description: string | null;
  // مستويات هيكل هذا المشروع بالترتيب، مثل ["برج","طابق"] (sql/044).
  // فارغ = مشروع بلا هيكل، وحداته في قائمة واحدة.
  structure_kinds: string[];
};

// عضو فريق كما يأتي من منظور team_members الآمن.
// ⚠️ لا يحتوي الراتب ولا العمولات — وهذا مقصود: صلاحيات القاعدة
// تعمل على الصف لا العمود، فالمنظور هو ما يحمي أعمدة الرواتب.
export type TeamMember = {
  id: string;
  user_id: string | null;
  full_name: string;
  job_title: string | null;
  department: string | null;
  phone: string | null;
  hire_date: string | null;
  status: string;
  project_id: string | null;
  exempt_from_attendance: boolean;
  work_start_time: string | null;
  work_end_time: string | null;
  work_days: number[] | null;
};

export const USER_ROLES = [
  "admin",
  "supervisor",
  "followup_manager",
  "relationship_manager",
  "broker",
  "employee",
] as const;

export const ROLE_LABELS: Record<string, string> = {
  admin: "مدير",
  supervisor: "مشرف",
  followup_manager: "مدير المتابعة",
  relationship_manager: "مدير علاقات",
  broker: "شركة وسيطة",
  employee: "موظف",
};

export const ROLE_COLORS: Record<string, string> = {
  admin: "bg-green-100 text-green-700",
  supervisor: "bg-blue-100 text-blue-700",
  followup_manager: "bg-purple-100 text-purple-700",
  relationship_manager: "bg-teal-100 text-teal-700",
  broker: "bg-orange-100 text-orange-700",
  employee: "bg-gray-100 text-gray-600",
};

// ===== الشركاء والتصفية =====

export type Partner = {
  id: string;
  name: string;
  share_percent: number;
  created_at: string;
};

export type PartnerSettlement = {
  id: string;
  created_at: string;
  settlement_date: string;
  from_partner: string;
  to_partner: string;
  amount: number;
  notes: string | null;
};

// ===== المحاسبة المبسّطة (الحركات المالية) =====
// المبدأ: المستخدم يُدخل معلومة بسيطة، والنظام يحوّلها لقيد مزدوج تلقائياً.

export type MoneyDirection = "صرف" | "قبض";

// أذرع النشاط — لمعرفة أين تُصرف الأموال بالضبط
export const ARMS = ["العقارات", "التسويق", "إداري عام"] as const;
export type Arm = (typeof ARMS)[number];

export const ARM_COLORS: Record<string, string> = {
  "العقارات": "bg-brand-50 text-brand-700",
  "التسويق": "bg-purple-100 text-purple-700",
  "إداري عام": "bg-gray-100 text-gray-600",
};

// تصنيف مبسّط = اسم عربي مفهوم + الحساب المحاسبي الذي يقابله خلف الكواليس
export type MoneyCategory = {
  label: string;
  account: string; // كود الحساب في شجرة الحسابات
  icon: string; // Material Symbols
  hint?: string; // شرح بسيط يظهر للمستخدم
  partnerOnly?: boolean; // تصنيف خاص بحركة بين الشركة والشريك
};

// ما نصرفه
export const EXPENSE_CATEGORIES: MoneyCategory[] = [
  { label: "رواتب وأجور", account: "5100", icon: "payments", hint: "رواتب الموظفين والأجور اليومية" },
  { label: "إيجار", account: "5200", icon: "home_work", hint: "إيجار المكتب أو المعرض" },
  { label: "تسويق وإعلان", account: "5700", icon: "campaign", hint: "إعلانات، سوشيال ميديا، لوحات، مصمّمين" },
  { label: "عمولات مدفوعة", account: "5500", icon: "handshake", hint: "عمولة مندوب أو دلّال" },
  { label: "فواتير خدمات", account: "5400", icon: "bolt", hint: "كهرباء، ماء، إنترنت، مولّدة" },
  { label: "صيانة وتصليحات", account: "5600", icon: "build", hint: "صيانة المكتب أو السيارات" },
  { label: "مصاريف مكتب ولوازم", account: "5300", icon: "inventory_2", hint: "قرطاسية، أثاث بسيط، مستلزمات" },
  { label: "وقود ومواصلات", account: "5310", icon: "local_gas_station", hint: "بنزين، تاكسي، سفر" },
  { label: "ضيافة وطعام", account: "5320", icon: "restaurant", hint: "ضيافة الزبائن، غداء الفريق" },
  { label: "اشتراكات وبرامج", account: "5330", icon: "cloud", hint: "اشتراكات شهرية، برامج، استضافة" },
  { label: "رسوم حكومية ومعاملات", account: "5340", icon: "gavel", hint: "طابو، إجازات، رسوم رسمية" },
  { label: "سداد لشريك", account: "2500", icon: "account_balance_wallet", hint: "الشركة تُرجع مبلغاً لشريك دفعه من جيبه" },
  { label: "أخرى", account: "5800", icon: "more_horiz" },
];

// ما نقبضه
export const INCOME_CATEGORIES: MoneyCategory[] = [
  { label: "بيع عقار أو وحدة", account: "4100", icon: "sell", hint: "مبلغ مستلم من بيع وحدة" },
  { label: "عمولة عقارية", account: "4200", icon: "real_estate_agent", hint: "عمولتنا على صفقة" },
  { label: "خدمات تسويق", account: "4400", icon: "ads_click", hint: "إيراد ذراع التسويق من زبائنه" },
  { label: "إيداع من شريك", account: "2500", icon: "savings", hint: "شريك يضخّ أموالاً في صندوق الشركة", partnerOnly: true },
  { label: "إيراد آخر", account: "4300", icon: "more_horiz" },
];

export function categoriesFor(direction: MoneyDirection): MoneyCategory[] {
  return direction === "صرف" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
}

export function findCategory(
  direction: MoneyDirection,
  label: string
): MoneyCategory | undefined {
  return categoriesFor(direction).find((c) => c.label === label);
}

export type CashMove = {
  id: string;
  created_at: string;
  created_by: string | null;
  move_date: string;
  direction: MoneyDirection;
  amount: number;
  category: string;
  account_code: string;
  arm: string;
  method: "نقد" | "بنك";
  partner_id: string | null;
  description: string;
  notes: string | null;
  journal_entry_id: string | null;
};

// ===== المهام اليومية =====

export type Task = {
  id: string;
  created_at: string;

  // من طلب المهمة (يُثبَّت داخل القاعدة فلا يُزوَّر)
  created_by: string | null;
  created_by_name: string | null;
  created_by_role: string | null; // مدير | موظف

  assigned_to: string;
  assigned_to_name: string | null;

  title: string;
  description: string | null;

  priority: string; // عاجلة | متوسطة | عادية
  status: string;   // جديدة | قيد التنفيذ | منجزة | ملغاة

  due_date: string;        // يوم التنفيذ YYYY-MM-DD
  due_time: string | null; // وقت اختياري HH:MM:SS

  next_step: string | null;      // الخطوة القادمة
  follow_up_date: string | null; // موعد المتابعة

  client_id: string | null;

  completed_at: string | null;
  updated_at: string;
};

export const TASK_STATUSES = ["جديدة", "قيد التنفيذ", "منجزة", "ملغاة"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// الحالات التي ما زالت تحتاج عملاً
export const OPEN_TASK_STATUSES = ["جديدة", "قيد التنفيذ"] as const;

export function isOpenTask(status: string): boolean {
  return status === "جديدة" || status === "قيد التنفيذ";
}

export const TASK_STATUS_COLORS: Record<string, string> = {
  "جديدة": "bg-blue-100 text-blue-700",
  "قيد التنفيذ": "bg-amber-100 text-amber-700",
  "منجزة": "bg-emerald-100 text-emerald-700",
  "ملغاة": "bg-gray-100 text-gray-500",
};

export const TASK_PRIORITIES = ["عاجلة", "متوسطة", "عادية"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_COLORS: Record<string, string> = {
  "عاجلة": "bg-red-100 text-red-700",
  "متوسطة": "bg-amber-100 text-amber-700",
  "عادية": "bg-gray-100 text-gray-600",
};

// شريط جانبي ملوّن للبطاقة حسب الأولوية
export const TASK_PRIORITY_BORDER: Record<string, string> = {
  "عاجلة": "border-s-red-500",
  "متوسطة": "border-s-amber-500",
  "عادية": "border-s-gray-300",
};

// «من طلب المهمة» — أهم معلومة يريدها الموظف عند فتح مهمته
export function taskOrigin(task: Task, myUserId: string | null): string {
  if (task.created_by && task.created_by === task.assigned_to) {
    return task.created_by === myUserId ? "أضفتها بنفسي" : "أضافها لنفسه";
  }
  const who = task.created_by_name || "غير معروف";
  const role = task.created_by_role === "مدير" ? "المدير " : "";
  return `طلبها: ${role}${who}`;
}

// متأخرة = يوم التنفيذ مضى ولم تُنجز (todayISO بتوقيت بغداد)
export function isTaskLate(task: Task, todayISO: string): boolean {
  return isOpenTask(task.status) && task.due_date < todayISO;
}

// وصف مقروء ليوم المهمة: اليوم / أمس / غداً / التاريخ
export function dayLabel(dateISO: string, todayISO: string): string {
  if (dateISO === todayISO) return "اليوم";
  const diff = Math.round(
    (new Date(dateISO + "T00:00:00Z").getTime() -
      new Date(todayISO + "T00:00:00Z").getTime()) /
      86400000
  );
  if (diff === -1) return "أمس";
  if (diff === 1) return "غداً";
  if (diff < 0) return `متأخرة ${Math.abs(diff)} يوم`;
  if (diff <= 7) return `بعد ${diff} أيام`;
  return dateISO;
}

// ===== المحادثات الداخلية =====

// صف واحد من دالة my_conversations() في القاعدة
export type ConversationRow = {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  is_announcement: boolean;
  last_message_at: string | null;
  last_message_text: string | null;
  last_sender_name: string | null;
  unread: number;
  other_user: string | null;
  display_title: string;
  member_count: number;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

export type ChatPerson = {
  user_id: string;
  name: string;
  email: string | null;
  role: string; // admin | employee
};

// لون ثابت لصورة الحرف الأول (نفس الشخص = نفس اللون دائماً)
const AVATAR_COLORS = [
  "bg-brand-100 text-brand-700",
  "bg-blue-100 text-blue-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
];

export function avatarColor(seed: string): string {
  let sum = 0;
  for (let i = 0; i < seed.length; i++) sum += seed.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const clean = (name || "؟").trim();
  return clean ? clean[0] : "؟";
}

// ===== أدوات رقم الهاتف العراقي =====
// المحلي: 11 رقم يبدأ بـ 07  (مثال: 07701234567)
// الدولي: +964 ثم الرقم بدون الصفر (مثال: +9647701234567)
export const IRAQ_PHONE_LOCAL = /^07\d{9}$/;
export const IRAQ_PHONE_INTL = /^\+9647\d{9}$/;

export function isValidIraqPhone(phone: string): boolean {
  return IRAQ_PHONE_LOCAL.test(phone) || IRAQ_PHONE_INTL.test(phone);
}

// تحويل محلي ← → دولي (يخصّ العراق؛ الأرقام الأجنبية محفوظة بـ + أصلاً)
export function toIntlPhone(phone: string): string {
  return phone.startsWith("0") ? "+964" + phone.slice(1) : phone;
}
export function toLocalPhone(phone: string): string {
  return phone.startsWith("+964") ? "0" + phone.slice(4) : phone;
}

// ============================================================
// أرقام الدول.
//
// **صيغة الحفظ:**
//   العراق  → محلي كما هو معتاد: 07701234567
//             (هكذا كل بياناتك السابقة، فلا نغيّرها)
//   غيره    → دولي دائماً: +9715xxxxxxx
//
// الفرق مقصود: الموظف العراقي يكتب ويقرأ 07…، والرقم الأجنبي بلا
// مفتاح دولة لا معنى له. `toIntlPhone` توحّدهما عند الاتصال وواتساب.
// ============================================================

export type CountryCode = {
  iso: string;    // مفتاح داخلي فقط
  name: string;
  dial: string;   // مع علامة +
  digits: number; // طول الرقم الوطني المتوقّع (0 = غير محدّد)
};

// العراق أولاً، ثم الجوار، ثم بلدان الاغتراب الشائعة
export const COUNTRY_CODES: CountryCode[] = [
  { iso: "IQ", name: "العراق", dial: "+964", digits: 10 },
  { iso: "SA", name: "السعودية", dial: "+966", digits: 9 },
  { iso: "AE", name: "الإمارات", dial: "+971", digits: 9 },
  { iso: "KW", name: "الكويت", dial: "+965", digits: 8 },
  { iso: "QA", name: "قطر", dial: "+974", digits: 8 },
  { iso: "BH", name: "البحرين", dial: "+973", digits: 8 },
  { iso: "OM", name: "عُمان", dial: "+968", digits: 8 },
  { iso: "JO", name: "الأردن", dial: "+962", digits: 9 },
  { iso: "LB", name: "لبنان", dial: "+961", digits: 0 },
  { iso: "SY", name: "سوريا", dial: "+963", digits: 9 },
  { iso: "PS", name: "فلسطين", dial: "+970", digits: 9 },
  { iso: "EG", name: "مصر", dial: "+20", digits: 10 },
  { iso: "TR", name: "تركيا", dial: "+90", digits: 10 },
  { iso: "IR", name: "إيران", dial: "+98", digits: 10 },
  { iso: "GB", name: "بريطانيا", dial: "+44", digits: 0 },
  { iso: "DE", name: "ألمانيا", dial: "+49", digits: 0 },
  { iso: "SE", name: "السويد", dial: "+46", digits: 0 },
  { iso: "NL", name: "هولندا", dial: "+31", digits: 0 },
  { iso: "FR", name: "فرنسا", dial: "+33", digits: 0 },
  { iso: "US", name: "أمريكا / كندا", dial: "+1", digits: 10 },
  { iso: "AU", name: "أستراليا", dial: "+61", digits: 0 },
];

export const DEFAULT_COUNTRY_ISO = "IQ";

export function countryByIso(iso: string): CountryCode {
  return (
    COUNTRY_CODES.find((c) => c.iso === iso) ??
    COUNTRY_CODES[0] // العراق
  );
}

// الأطول أولاً: لولاه لالتقط +9 مفتاحاً خاطئاً لأرقام +964 و +966
const DIALS_LONGEST_FIRST = [...COUNTRY_CODES].sort(
  (a, b) => b.dial.length - a.dial.length
);

// الرقم المخزَّن → (الدولة + الجزء الوطني)، لملء النموذج
export function splitPhone(phone: string | null | undefined): {
  iso: string;
  national: string;
} {
  const v = (phone ?? "").trim();
  if (!v) return { iso: DEFAULT_COUNTRY_ISO, national: "" };

  // محلي عراقي (07…)
  if (!v.startsWith("+")) return { iso: "IQ", national: v };

  const match = DIALS_LONGEST_FIRST.find((c) => v.startsWith(c.dial));
  if (!match) return { iso: DEFAULT_COUNTRY_ISO, national: v };

  const national = v.slice(match.dial.length);
  // +964770… يُعرض للموظف بالصيغة المحلية التي اعتادها
  if (match.iso === "IQ") return { iso: "IQ", national: "0" + national };
  return { iso: match.iso, national };
}

// (الدولة + الجزء الوطني) → الرقم المخزَّن
export function composePhone(iso: string, national: string): string {
  const digits = national.replace(/[^\d]/g, "");
  if (!digits) return "";

  if (iso === "IQ") {
    // نحفظ العراقي محلياً: نضيف الصفر إن كتبه الموظف بدونه
    return digits.startsWith("0") ? digits : "0" + digits;
  }

  // الأجنبي بلا صفر وطني بادئ (07911… في بريطانيا تصير +447911…)
  return countryByIso(iso).dial + digits.replace(/^0+/, "");
}

// تحقّق عام يقبل العراقي والأجنبي معاً
export function isValidPhone(phone: string): boolean {
  const v = (phone ?? "").trim();
  if (!v) return false;

  // العراق يبقى صارماً: 11 رقماً تبدأ بـ 07
  if (!v.startsWith("+")) return IRAQ_PHONE_LOCAL.test(v);
  if (v.startsWith("+964")) return IRAQ_PHONE_INTL.test(v);

  const match = DIALS_LONGEST_FIRST.find((c) => v.startsWith(c.dial));
  if (!match) return false; // مفتاح دولة غير معروف

  const national = v.slice(match.dial.length);
  if (!/^\d+$/.test(national)) return false;
  if (match.digits > 0) return national.length === match.digits;
  // بلا طول محدّد: نتبع المعيار الدولي E.164
  return national.length >= 4 && national.length <= 14;
}

// نصّ إرشادي لكل دولة (يظهر تحت الحقل)
export function phoneHint(iso: string): string {
  if (iso === "IQ") return "11 رقماً تبدأ بـ 07 — مثال 07701234567";
  const c = countryByIso(iso);
  return c.digits > 0
    ? `${c.digits} أرقام بعد ${c.dial} (بلا الصفر الأول)`
    : `الرقم بعد ${c.dial} بلا الصفر الأول`;
}

// ============================================================
// المخزون — مواد مركز المبيعات ومشترياتها وصرفها (sql/040)
//
// المبدأ: `quantity` **ناتج** جمع الحركات لا حقل يُكتب فيه. الواجهة
// تعرضه ولا تحرّره؛ من أراد تغييره يسجّل حركة. لهذا لا يوجد حقل
// كمية في نموذج المادة إلا «الرصيد الافتتاحي» عند الإنشاء، وهو
// نفسه يُسجَّل كحركة تسوية.
// ============================================================

export type Supplier = {
  id: string;
  created_at: string;
  created_by: string | null;
  name: string;
  phone: string | null;
  contact_person: string | null;
  address: string | null;
  is_active: boolean;
  notes: string | null;
};

export type InventoryItem = {
  id: string;
  created_at: string;
  created_by: string | null;
  name: string;
  category: string;
  unit: string;                 // وحدة القياس
  quantity: number;             // الرصيد الحالي (محسوب من الحركات)
  min_quantity: number;         // الحد الأدنى — تحته يصل تنبيه
  supplier_id: string | null;   // المورد المعتاد
  last_purchase_date: string | null;
  last_purchase_price: number | null;
  is_active: boolean;
  notes: string | null;
  // مرتبط (عند الجلب مع المورد)
  suppliers?: { name: string } | null;
};

export type InventoryMove = {
  id: string;
  created_at: string;
  created_by: string | null;
  actor_name: string | null;
  item_id: string;
  kind: string;                 // شراء | صرف | تسوية
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
  supplier_id: string | null;
  moved_at: string;             // YYYY-MM-DD
  issued_to: string | null;     // صُرف إلى
  notes: string | null;
  // مرتبط
  inventory_items?: { name: string; unit: string; category: string } | null;
  suppliers?: { name: string } | null;
};

// التصنيفات — تطابق قيد inventory_items_category_chk في القاعدة حرفاً بحرف
export const INVENTORY_CATEGORIES = [
  "مطبوعات ومواد تسويقية",
  "مياه شرب",
  "مواد تنظيف",
  "معطرات",
  "مناديل",
  "مستلزمات مكتبية",
  "ضيافة",
  "مستلزمات أخرى",
] as const;

export const INVENTORY_CATEGORY_ICONS: Record<string, string> = {
  "مطبوعات ومواد تسويقية": "print",
  "مياه شرب": "water_drop",
  "مواد تنظيف": "cleaning_services",
  "معطرات": "spa",
  "مناديل": "inventory",
  "مستلزمات مكتبية": "edit_note",
  "ضيافة": "local_cafe",
  "مستلزمات أخرى": "inventory_2",
};

export const INVENTORY_CATEGORY_COLORS: Record<string, string> = {
  "مطبوعات ومواد تسويقية": "bg-indigo-100 text-indigo-700",
  "مياه شرب": "bg-sky-100 text-sky-700",
  "مواد تنظيف": "bg-teal-100 text-teal-700",
  "معطرات": "bg-purple-100 text-purple-700",
  "مناديل": "bg-pink-100 text-pink-700",
  "مستلزمات مكتبية": "bg-amber-100 text-amber-700",
  "ضيافة": "bg-orange-100 text-orange-700",
  "مستلزمات أخرى": "bg-gray-100 text-gray-600",
};

// وحدات القياس المقترحة (الحقل يقبل غيرها كتابةً)
export const INVENTORY_UNITS = [
  "قطعة",
  "كارتون",
  "علبة",
  "عبوة",
  "كيس",
  "رزمة",
  "لتر",
  "كيلو",
  "متر",
] as const;

export const MOVE_KINDS = ["شراء", "صرف", "تسوية"] as const;

export const MOVE_KIND_COLORS: Record<string, string> = {
  "شراء": "bg-emerald-100 text-emerald-700",
  "صرف": "bg-red-100 text-red-700",
  "تسوية": "bg-gray-100 text-gray-600",
};

export const MOVE_KIND_ICONS: Record<string, string> = {
  "شراء": "add_shopping_cart",
  "صرف": "output",
  "تسوية": "tune",
};

// أثر الحركة على الرصيد — نفس منطق recalc_inventory_item في القاعدة
export function moveDelta(move: Pick<InventoryMove, "kind" | "quantity">): number {
  if (move.kind === "صرف") return -move.quantity;
  return move.quantity; // شراء موجب، وتسوية بإشارتها كما أُدخلت
}

// حالة المادة — عليها يُبنى لون البطاقة وترتيب التنبيهات
export type StockState = "نفدت" | "منخفضة" | "قريبة" | "جيدة";

export function stockState(item: InventoryItem): StockState {
  if (item.quantity <= 0) return "نفدت";
  if (item.min_quantity > 0 && item.quantity < item.min_quantity) return "منخفضة";
  // «قريبة» = فوق الحد الأدنى بأقل من ٢٥٪ منه — تحذير مبكر قبل النفاد
  if (item.min_quantity > 0 && item.quantity <= item.min_quantity * 1.25)
    return "قريبة";
  return "جيدة";
}

export const STOCK_STATE_COLORS: Record<StockState, string> = {
  "نفدت": "bg-red-100 text-red-700",
  "منخفضة": "bg-amber-100 text-amber-700",
  "قريبة": "bg-yellow-100 text-yellow-700",
  "جيدة": "bg-emerald-100 text-emerald-700",
};

export const STOCK_STATE_BORDER: Record<StockState, string> = {
  "نفدت": "border-s-red-500",
  "منخفضة": "border-s-amber-500",
  "قريبة": "border-s-yellow-500",
  "جيدة": "border-s-emerald-500",
};

// عرض الكمية بلا أصفار عشرية زائدة: 80 لا 80.00، و2.5 تبقى 2.5
export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return (Math.round(n * 100) / 100).toLocaleString("en-US");
}

// ============================================================
// الماستر بروكر — شركات وساطة تُدخل ليداتها وتأخذ عمولتها (sql/043)
//
// ثلاث قواعد تحكم كل ما يلي:
//   • العمولة = نسبة من سعر الوحدة، تُثبَّت على السجلّ وقت البيع
//     (لا تُقرأ من ملف الشركة لاحقاً، فتغيير النسبة لا يعيد كتابة
//      التاريخ).
//   • الليد للشركة ٣٠ يوماً من إدخاله ثم يعود لتلال — والعدّاد لا
//     يتجدد بالتواصل.
//   • حالة العمولة تُحسب من مدفوعاتها لا تُخزَّن، كفواتير النظام.
// ============================================================

export type BrokerCompany = {
  id: string;
  created_at: string;
  created_by: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  license_no: string | null;
  commission_rate: number;   // ٪ من سعر الوحدة
  is_active: boolean;
  notes: string | null;
};

export type BrokerUser = {
  user_id: string;
  company_id: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  broker_companies?: { name: string } | null;
};

// إسناد شركة لمشروع + مدير العلاقات المسؤول عنها فيه
export type BrokerCompanyProject = {
  company_id: string;
  project_id: string;
  rm_id: string | null;
  created_at: string;
  projects?: { name: string } | null;
  broker_companies?: { name: string } | null;
};

export type BrokerCommission = {
  id: string;
  created_at: string;
  created_by: string | null;
  company_id: string;
  client_id: string | null;
  unit_id: string | null;
  reservation_id: string | null;
  project_id: string | null;
  deal_amount: number;
  rate: number;
  amount: number;
  earned_at: string;
  notes: string | null;
  // مرتبط
  broker_companies?: { name: string } | null;
  clients?: { name: string } | null;
  units?: { project: string | null; unit_code: string | null } | null;
  projects?: { name: string } | null;
};

export type BrokerPayment = {
  id: string;
  created_at: string;
  created_by: string | null;
  commission_id: string;
  amount: number;
  payment_date: string;
  method: string | null;
  notes: string | null;
};

export type LeadTransfer = {
  id: string;
  moved_at: string;
  client_id: string;
  from_company_id: string | null;
  to_company_id: string | null;
  reason: string | null;
  moved_by: string | null;
  actor_name: string | null;
};

export const BROKER_PAYMENT_METHODS = ["كاش", "تحويل بنكي", "صك"] as const;

// ===== حالة العمولة =====

export type CommissionStatus = "مستحقة" | "مدفوعة جزئياً" | "مدفوعة";

export function commissionStatus(
  amount: number,
  paid: number
): CommissionStatus {
  if (paid <= 0) return "مستحقة";
  if (paid >= amount - 0.01) return "مدفوعة";
  return "مدفوعة جزئياً";
}

export const COMMISSION_STATUS_COLORS: Record<CommissionStatus, string> = {
  "مستحقة": "bg-amber-100 text-amber-700",
  "مدفوعة جزئياً": "bg-blue-100 text-blue-700",
  "مدفوعة": "bg-emerald-100 text-emerald-700",
};

// ===== مهلة الليد =====

// كم يوماً بقي للشركة على هذا الليد؟ (سالب = انتهت المهلة)
export function leadDaysLeft(deadline: string | null | undefined): number | null {
  if (!deadline) return null;
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Baghdad",
  });
  return Math.round(
    (new Date(deadline + "T00:00:00Z").getTime() -
      new Date(today + "T00:00:00Z").getTime()) /
      86400000
  );
}

// لون العدّاد: يشتدّ كلّما اقترب انتهاء المهلة
export function leadDeadlineColor(daysLeft: number | null): string {
  if (daysLeft === null) return "bg-gray-100 text-gray-500";
  if (daysLeft < 0) return "bg-red-100 text-red-700";
  if (daysLeft <= 3) return "bg-red-100 text-red-700";
  if (daysLeft <= 7) return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
}

export function leadDeadlineLabel(daysLeft: number | null): string {
  if (daysLeft === null) return "بلا مهلة";
  if (daysLeft < 0) return "انتهت المهلة";
  if (daysLeft === 0) return "آخر يوم";
  if (daysLeft === 1) return "باقٍ يوم";
  if (daysLeft === 2) return "باقٍ يومان";
  return `باقٍ ${daysLeft} يوماً`;
}

// ============================================================
// مخزون المشاريع العقارية (sql/044)
//
// المشروع صار مخزوناً: هيكل شجري ديناميكي، ووحدات حقولها تتبدّل
// حسب نوعها، وسجل يروي تاريخ كل وحدة.
// ============================================================

// مستويات الهيكل الممكنة — لا تُضاف هنا فقط بل في check القاعدة أيضاً
export const NODE_KINDS = ["برج", "مبنى", "طابق", "مرحلة", "مجمع", "منطقة"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

// قوالب جاهزة تُغني المستخدم عن تصميم هيكله من الصفر.
// وهي اقتراح لا قيد: يستطيع تركيب أي تسلسل من NODE_KINDS.
export const STRUCTURE_PRESETS: { label: string; hint: string; kinds: NodeKind[] }[] = [
  { label: "أبراج وشقق", hint: "برج ← طابق ← شقة", kinds: ["برج", "طابق"] },
  { label: "مبانٍ وشقق", hint: "مبنى ← طابق ← شقة", kinds: ["مبنى", "طابق"] },
  { label: "دور وفلل", hint: "مرحلة ← دار", kinds: ["مرحلة"] },
  { label: "مجمّعات", hint: "مرحلة ← مجمع ← وحدة", kinds: ["مرحلة", "مجمع"] },
  { label: "مناطق", hint: "منطقة ← وحدة", kinds: ["منطقة"] },
];

export const NODE_KIND_ICONS: Record<string, string> = {
  "برج": "apartment",
  "مبنى": "domain",
  "طابق": "layers",
  "مرحلة": "flag",
  "مجمع": "holiday_village",
  "منطقة": "map",
};

export type ProjectNode = {
  id: string;
  created_at: string;
  created_by: string | null;
  project_id: string;
  parent_id: string | null;
  kind: string;
  name: string;
  sort_order: number;
  depth: number;
  path: string;       // «برج A / الطابق 01» — تحسبه القاعدة
  notes: string | null;
};

// عقدة الهيكل بعد بناء الشجرة في الذاكرة
export type NodeTree = ProjectNode & { children: NodeTree[] };

export function buildNodeTree(nodes: ProjectNode[]): NodeTree[] {
  const byId = new Map<string, NodeTree>();
  for (const n of nodes) byId.set(n.id, { ...n, children: [] });

  const roots: NodeTree[] = [];
  for (const n of Array.from(byId.values())) {
    const parent = n.parent_id ? byId.get(n.parent_id) : null;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }

  const sort = (list: NodeTree[]) => {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ar"));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

// ===== أنواع الوحدات =====

export type UnitTypeRow = {
  name: string;
  category: string;  // عمودي · أفقي · تجاري · أرض · أخرى
  sort_order: number;
  active: boolean;
};

// أي حقول تظهر لأي فئة — هذا هو «النموذج الديناميكي»:
// الفئة تأتي من القاعدة، والنموذج يسأل هذه الدالة لا شرطاً مكتوباً.
export type UnitField =
  | "space_m2"        // مساحة الوحدة
  | "land_area_m2"    // مساحة الأرض
  | "built_area_m2"   // مساحة البناء
  | "rooms"
  | "bathrooms"
  | "floors_count"
  | "parking_spaces"
  | "view"
  | "balcony"
  | "garden_area"
  | "roof"
  | "model"
  | "frontage"
  | "direction"   // اتجاه الوحدة (SE/NW…) — يميّز شققاً متطابقة المساحة
  | "layout";     // التصميم كما يكتبه المطوّرون: 2+1 أي غرفتان وصالة

export function unitFieldsFor(category: string): UnitField[] {
  switch (category) {
    case "عمودي":
      return [
        "space_m2", "built_area_m2", "layout", "rooms", "bathrooms",
        "parking_spaces", "direction", "view", "balcony",
      ];
    case "أفقي":
      return [
        "land_area_m2", "built_area_m2", "floors_count", "rooms", "bathrooms",
        "parking_spaces", "garden_area", "roof", "model",
      ];
    case "تجاري":
      return ["space_m2", "built_area_m2", "frontage", "bathrooms", "parking_spaces", "direction"];
    case "أرض":
      return ["land_area_m2", "frontage"];
    default:
      return ["space_m2", "rooms", "bathrooms"];
  }
}

// الحقول التي تعيش داخل attrs (jsonb) لا في أعمدة
export const JSON_UNIT_FIELDS: UnitField[] = [
  "view", "balcony", "garden_area", "roof", "model", "frontage",
  "direction", "layout",
];

export const UNIT_FIELD_LABELS: Record<UnitField, string> = {
  space_m2: "المساحة (م²)",
  land_area_m2: "مساحة الأرض (م²)",
  built_area_m2: "مساحة البناء (م²)",
  rooms: "غرف النوم",
  bathrooms: "الحمّامات",
  floors_count: "عدد الطوابق",
  parking_spaces: "مواقف السيارات",
  view: "الإطلالة",
  balcony: "شرفة",
  garden_area: "مساحة الحديقة (م²)",
  roof: "سطح / تراس",
  model: "الموديل",
  frontage: "الواجهة (م)",
  direction: "الاتجاه",
  layout: "التصميم",
};

// ===== حالة الوحدة =====

export const UNIT_STATUS_LIST = ["متاحة", "محجوزة", "مباعة", "موقوفة"] as const;
export type UnitStatus = (typeof UNIT_STATUS_LIST)[number];

export const UNIT_STATUS_DOTS: Record<string, string> = {
  "متاحة": "bg-green-500",
  "محجوزة": "bg-amber-500",
  "مباعة": "bg-red-500",
  "موقوفة": "bg-gray-400",
};

// ما يجوز على الوحدة حسب حالتها — الشاشة تسأل هنا، والقاعدة تفرض
// نفس القاعدة بمحفّز، فلا يكفي إخفاء الزر (sql/044).
export function canReserve(status: string): boolean {
  return status === "متاحة";
}
export function canSell(status: string): boolean {
  return status === "محجوزة";
}

export type UnitEvent = {
  id: string;
  created_at: string;
  unit_id: string;
  kind: string;
  detail: string | null;
  actor: string | null;
  actor_name: string | null;
};

export const UNIT_EVENT_ICONS: Record<string, string> = {
  "إنشاء": "add_circle",
  "تعديل سعر": "sell",
  "تغيير حالة": "swap_horiz",
  "نقل": "move_down",
  "حجز": "event_available",
  "إلغاء حجز": "event_busy",
  "بيع": "handshake",
  "طلب بيع": "pending_actions",
  "رفض بيع": "cancel",
  "فاتورة": "receipt_long",
  "دفعة": "payments",
};

export type UnitFinance = {
  unit_id: string;
  unit_price: number | null;
  invoiced: number;
  paid: number;
  remaining: number;
};

// ملخّص مخزون مشروع
export type InventorySummary = {
  total: number;
  available: number;
  reserved: number;
  sold: number;
  blocked: number;
  value: number;      // قيمة كل الوحدات
  soldValue: number;  // قيمة المباع
};

export function summarizeUnits(units: { status: string; price: number | null }[]): InventorySummary {
  const s: InventorySummary = {
    total: units.length, available: 0, reserved: 0, sold: 0, blocked: 0,
    value: 0, soldValue: 0,
  };
  for (const u of units) {
    const price = u.price ?? 0;
    s.value += price;
    if (u.status === "متاحة") s.available++;
    else if (u.status === "محجوزة") s.reserved++;
    else if (u.status === "مباعة") { s.sold++; s.soldValue += price; }
    else if (u.status === "موقوفة") s.blocked++;
  }
  return s;
}

// ============================================================
// أدوات المخزون في الذاكرة.
//
// تعيش هنا لا في estate.ts لأن استعراض المخزون مكوّن عميل، و
// estate.ts يستورد عميل Supabase الخادمي — فاستيراده من العميل
// يكسر البناء. القاعدة: ما لا يلمس الشبكة يبقى في types.
// ============================================================

/** وحدات كل عقدة، مفهرسة بمعرّف العقدة. الوحدات بلا هيكل تحت "" */
export function unitsByNode(units: Unit[]): Map<string, Unit[]> {
  const map = new Map<string, Unit[]>();
  for (const u of units) {
    const key = u.node_id ?? "";
    const list = map.get(key);
    if (list) list.push(u);
    else map.set(key, [u]);
  }
  return map;
}

/**
 * تصفية الوحدات. القيمة الفارغة تعني «لا تصفية بهذا الحقل»، فالمرشّح
 * الفارغ لا يحذف شيئاً — وهذا ما يجعل تركيب المرشّحات آمناً.
 */
export type UnitFilters = {
  q?: string;
  status?: string;
  unitType?: string;
  nodeId?: string;      // العقدة وكل ما تحتها
  minPrice?: number;
  maxPrice?: number;
  minRooms?: number;
};

export function filterUnits(
  units: Unit[],
  f: UnitFilters,
  descendantIds?: Set<string>,
): Unit[] {
  const q = f.q?.trim().toLowerCase();

  return units.filter((u) => {
    if (f.status && u.status !== f.status) return false;
    if (f.unitType && u.unit_type !== f.unitType) return false;
    if (f.nodeId && !(descendantIds?.has(u.node_id ?? "") ?? u.node_id === f.nodeId)) return false;
    if (f.minPrice !== undefined && (u.price ?? 0) < f.minPrice) return false;
    if (f.maxPrice !== undefined && (u.price ?? 0) > f.maxPrice) return false;
    if (f.minRooms !== undefined && (u.rooms ?? 0) < f.minRooms) return false;

    if (q) {
      const hay = [u.unit_code, u.node_path, u.unit_type, u.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** العقدة وكل ذرّيتها — لأن اختيار «برج A» يعني كل طوابقه */
export function descendantsOf(nodes: ProjectNode[], rootId: string): Set<string> {
  const byParent = new Map<string, ProjectNode[]>();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    const list = byParent.get(n.parent_id);
    if (list) list.push(n);
    else byParent.set(n.parent_id, [n]);
  }

  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    for (const child of byParent.get(id) ?? []) {
      if (!out.has(child.id)) {
        out.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return out;
}

// ============================================================
// تسليم ملفات موظف انتهت خدمته (sql/045).
//
// ينتقل ما يُتابَع — العملاء والمهام المفتوحة والحجوزات القائمة —
// ويبقى ما استُحقّ: سجلّ تواصله وعمولاته ورواتبه.
// ============================================================
export type EmployeeHandover = {
  id: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  from_employee: string | null;
  from_name: string;
  to_employee: string | null;
  to_name: string;
  clients_moved: number;
  tasks_moved: number;
  reservations_moved: number;
  ended_service: boolean;
  revoked_access: boolean;
  note: string | null;
};

// ============================================================
// نظام العمولات (sql/048)
//
// طبقتان: عمولة الشركة من المشروع بشرائحها، ونصيب الموظف منها.
// النسبة الواحدة لم تكن تكفي — مشروعان بنسبتين، وشريحة تتغيّر
// بعدد الصفقات، وموظفان بقاعدتين.
// ============================================================

export type ProjectCommission = {
  project_id: string;
  base_rate: number;          // النسبة الأساسية %
  target_sales: number | null; // التاركت — للقياس لا للاحتساب
  notes: string | null;
  updated_at: string;
};

export type CommissionTier = {
  id: string;
  project_id: string;
  min_sales: number;  // من هذه الصفقة فصاعداً
  rate: number;
};

export const RULE_KINDS = [
  "نسبة من عمولة الشركة",
  "نسبة من سعر البيع",
  "مبلغ لكل متر",
  "مبلغ مقطوع",
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export function isRateKind(kind: string): boolean {
  return kind.startsWith("نسبة");
}

export type EmployeeCommissionRule = {
  id: string;
  created_at: string;
  created_by: string | null;
  employee_id: string | null;  // فارغ = كل الموظفين
  project_id: string | null;   // فارغ = كل المشاريع
  kind: string;
  value: number;
  min_area: number | null;
  max_area: number | null;
  active: boolean;
  notes: string | null;
};

export type SaleCommission = {
  id: string;
  created_at: string;
  reservation_id: string;
  project_id: string | null;
  unit_id: string | null;
  client_id: string | null;
  deal_amount: number;
  unit_area: number | null;
  sales_index: number;      // ترتيب الصفقة في مشروعها — به تُعرف الشريحة
  company_rate: number;
  company_amount: number;
  employee_id: string | null;
  employee_basis: string | null;
  employee_amount: number;
  rule_id: string | null;
  commission_id: string | null;
  collected_at: string | null; // فارغ = عمولة الشركة ما زالت مستحقّة
};

/** وصف القاعدة بعبارة يفهمها من يقرؤها بلا شرح */
export function ruleLabel(r: EmployeeCommissionRule): string {
  const v = isRateKind(r.kind)
    ? `${r.value}%`
    : `${r.value.toLocaleString("en-US")} د.ع`;
  const area =
    r.min_area !== null || r.max_area !== null
      ? ` · المساحة ${r.min_area ?? "0"}–${r.max_area ?? "∞"} م²`
      : "";
  return `${r.kind} ${v}${area}`;
}
