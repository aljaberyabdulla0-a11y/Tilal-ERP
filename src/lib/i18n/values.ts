// ============================================================
// ترجمة القيم المخزّنة في قاعدة البيانات.
//
// ⚠️ القيم تبقى **عربية في القاعدة** ولا تُترجَم عند الحفظ أبداً:
// هي مكتوبة داخل قيود CHECK ومحفّزات وسياسات صلاحيات وكل السجلّ
// التاريخي. تغييرها يكسر النظام. نترجم **العرض** فقط.
//
// أي قيمة غير موجودة هنا تُعرض كما هي — وهذا مقصود: أسماء العملاء
// والملاحظات وما يكتبه المستخدم يجب ألّا يُترجَم.
// ============================================================

import type { Locale } from "./config";

const EN: Record<string, string> = {
  // مراحل المبيعات
  "ليد": "Lead",
  "اتصال": "Contacted",
  "زيارة": "Visit",
  "مناقشة العرض": "Negotiation",
  "بيع": "Won",
  "فشل البيع": "Lost",

  // أنواع التواصل
  "مكالمة": "Call",
  "واتساب": "WhatsApp",
  "اجتماع": "Meeting",
  "عرض سعر": "Quotation",
  "ملاحظة": "Note",
  "تغيير مرحلة": "Stage change",

  // اتجاه التواصل ونتيجته
  "صادر": "Outgoing",
  "وارد": "Incoming",

  // الغرض من الشراء
  "سكن": "Residence",
  "استثمار": "Investment",

  // طرق الدفع
  "أقساط": "Instalments",
  "كاش": "Cash",
  "نص كاش": "Half cash",
  "قرض عقاري": "Mortgage",
  "نقد": "Cash",
  "بنك": "Bank",
  "تحويل بنكي": "Bank transfer",
  "صك": "Cheque",
  "بطاقة": "Card",

  // الوحدات العقارية
  "شقة": "Apartment",
  "أرض": "Land",
  "دار": "House",
  "فيلا": "Villa",
  "محل تجاري": "Shop",
  "متاحة": "Available",
  "محجوزة": "Reserved",
  "مباعة": "Sold",

  // الحجوزات
  "حجز": "Reservation",
  "بيع مكتمل": "Completed sale",
  "ملغى": "Cancelled",

  // الإجازات
  "سنوية": "Annual",
  "مرضية": "Sick",
  "طارئة": "Emergency",
  "بدون راتب": "Unpaid",
  "معلقة": "Pending",
  "موافق عليها": "Approved",
  "مرفوضة": "Rejected",
  "يوم كامل": "Full day",
  "ساعات": "Hours",

  // المهام
  "جديدة": "New",
  "قيد التنفيذ": "In progress",
  "منجزة": "Done",
  "ملغاة": "Cancelled",
  "عاجلة": "Urgent",
  "متوسطة": "Medium",
  "عادية": "Normal",

  // الحركات المالية والأذرع
  "صرف": "Money out",
  "قبض": "Money in",
  "العقارات": "Real estate",
  "التسويق": "Marketing",
  "إداري عام": "General admin",

  // الديون الخارجية
  "مقاول": "Contractor",
  "وسيط": "Broker",
  "مورّد": "Supplier",
  "موظف": "Employee",
  "جهة أخرى": "Other party",

  // مصدر بصمة الدوام
  "بصمة ذاتية": "Self check-in",
  "تسجيل يدوي بواسطة المدير": "Manual entry by manager",
  "رصيد افتتاحي": "Opening balance",
  "انصراف تلقائي": "Auto check-out",

  // حالات الدفع
  "مدفوع": "Paid",
  "مدفوع جزئياً": "Partially paid",
  "غير مدفوع": "Unpaid",
  "مدفوعة": "Paid",
  "مدفوعة جزئياً": "Partially paid",
  "غير مدفوعة": "Unpaid",

  // أنواع الإشعارات
  "متابعة": "Follow-up",
  "تصعيد": "Escalation",
  "إجازة": "Leave",
  "مهمة": "Task",
  "رسالة": "Message",
  "دوام": "Attendance",

  // الأدوار
  "مدير": "Manager",
  "مشرف": "Supervisor",

  // حالات المشروع
  "نشط": "Active",
  "مكتمل": "Completed",
  "متوقف": "On hold",

  // أنواع الحسابات المحاسبية
  "أصول": "Assets",
  "التزامات": "Liabilities",
  "حقوق ملكية": "Equity",
  "إيرادات": "Revenue",
  "مصاريف": "Expenses",
};

// قيمة مخزّنة → نصّها بلغة العرض. غير المعروف يمرّ كما هو.
export function tValue(value: string | null | undefined, locale: Locale): string {
  if (!value) return "";
  if (locale === "ar") return value;
  return EN[value] ?? value;
}

// نفس الشيء لقائمة كاملة (للقوائم المنسدلة): القيمة تبقى عربية والنص يُترجَم
export function tOptions<T extends string>(
  values: readonly T[],
  locale: Locale
): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: tValue(value, locale) }));
}
