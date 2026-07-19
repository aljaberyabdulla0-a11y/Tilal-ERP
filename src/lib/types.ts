// أنواع البيانات المشتركة في النظام

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
  source: string | null;        // مصدر العميل
  payment_method: string | null; // طريقة الدفع
  sales_employee: string | null; // موظف المبيعات
  entry_date: string | null;    // التاريخ (YYYY-MM-DD)
  notes: string | null;
  stage?: string;               // مرحلة المبيعات (Pipeline)
  follow_up_date?: string | null; // تاريخ المتابعة
};

// مراحل خطّ المبيعات (Sales Pipeline)
export const PIPELINE_STAGES = [
  "ليد",
  "اتصال",
  "زيارة",
  "مناقشة العرض",
  "بيع",
  "فشل البيع",
] as const;

// ألوان رأس كل مرحلة (Tailwind)
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
  project: string;         // المشروع / المجمّع
  unit_code: string | null; // رقم/كود الوحدة
  unit_type: string;        // نوع الوحدة
  governorate: string | null; // المحافظة
  area: string | null;      // المنطقة
  space_m2: number | null;  // المساحة (م²)
  rooms: number | null;     // عدد الغرف
  price: number | null;     // السعر
  status: string;           // الحالة
  notes: string | null;
};

// أنواع الوحدات
export const UNIT_TYPES = ["شقة", "أرض", "دار", "فيلا", "محل تجاري"] as const;

// حالات الوحدة
export const UNIT_STATUSES = ["متاحة", "محجوزة", "مباعة"] as const;

// ألوان شارة الحالة (Tailwind)
export const UNIT_STATUS_COLORS: Record<string, string> = {
  "متاحة": "bg-green-100 text-green-700",
  "محجوزة": "bg-amber-100 text-amber-700",
  "مباعة": "bg-gray-200 text-gray-600",
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
  // بيانات مرتبطة (تأتي من الربط مع الجداول الأخرى)
  clients?: { name: string } | null;
  units?: { project: string; unit_code: string | null } | null;
};

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
  notes: string | null;
  created_at: string;
};

export type Attendance = {
  id: string;
  employee_id: string;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  note: string | null;
};

export type Leave = {
  id: string;
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number | null;
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
};

export type Deduction = {
  id: string;
  employee_id: string;
  amount: number;
  ded_date: string;
  reason: string | null;
};

export type Payroll = {
  id: string;
  employee_id: string;
  period: string;
  basic: number;
  allowances: number;
  commissions_total: number;
  deductions_total: number;
  net: number;
  status: string; // مدفوع | غير مدفوع
  created_at: string;
  journal_entry_id: string | null; // القيد المحاسبي المرتبط (تكامل تلقائي)
};

export const LEAVE_TYPES = ["سنوية", "مرضية", "طارئة", "بدون راتب"] as const;
export const LEAVE_STATUSES = ["معلقة", "موافق عليها", "مرفوضة"] as const;

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

// تنسيق وقت (ساعة:دقيقة) من طابع زمني
export function formatTime(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
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

// ===== الشركاء والتصفية =====

export type Partner = {
  id: string;
  name: string;
  share_percent: number;
  created_at: string;
};

export type PartnerExpense = {
  id: string;
  created_at: string;
  expense_date: string;
  description: string;
  amount: number;
  paid_by: string;
  category: string | null;
  notes: string | null;
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

// ===== أدوات رقم الهاتف العراقي =====
// المحلي: 11 رقم يبدأ بـ 07  (مثال: 07701234567)
// الدولي: +964 ثم الرقم بدون الصفر (مثال: +9647701234567)
export const IRAQ_PHONE_LOCAL = /^07\d{9}$/;
export const IRAQ_PHONE_INTL = /^\+9647\d{9}$/;

export function isValidIraqPhone(phone: string): boolean {
  return IRAQ_PHONE_LOCAL.test(phone) || IRAQ_PHONE_INTL.test(phone);
}

// تحويل محلي ← → دولي
export function toIntlPhone(phone: string): string {
  return phone.startsWith("0") ? "+964" + phone.slice(1) : phone;
}
export function toLocalPhone(phone: string): string {
  return phone.startsWith("+964") ? "0" + phone.slice(4) : phone;
}
