// ============================================================
// ثوابت عرض الـCRM — **بلا أي استيراد من الخادم**.
//
// ⚠️ هذا الملف موجود لسبب واحد: `crm.ts` يستورد عميل Supabase الذي
//    يستورد `next/headers`، وهو للخادم وحده. فمكوّن عميل يستورد منه
//    قيمةً واحدة (لا نوعاً) يسحب السلسلة كلها فيفشل البناء.
//
//    الأنواع تُستورَد من crm.ts بأمان (`import type` يُمحى عند
//    الترجمة). **القيم** تُستورَد من هنا.
//
// وما فيه ألوانٌ لمعانٍ ثابتة لا حساب: درجة الحرارة أربع قيم تأتي
// من القاعدة (074) ولا تُحسب هنا ولا يُعاد تصنيفها — تُلوَّن فقط.
// ============================================================

export const TEMPERATURE_STYLE: Record<string, string> = {
  "ساخن": "bg-red-100 text-red-700",
  "دافئ": "bg-amber-100 text-amber-700",
  "بارد": "bg-blue-100 text-blue-700",
  "خامل": "bg-gray-100 text-gray-500",
};

export const SEVERITY_STYLE: Record<string, string> = {
  "عالٍ": "border-red-300 bg-red-50 text-red-900",
  "متوسط": "border-amber-300 bg-amber-50 text-amber-900",
  "منخفض": "border-gray-300 bg-gray-50 text-gray-700",
};

// درجة الليد: لونها يتبع عتبات القاعدة نفسها (٧٠ و٤٠ في 074)
export function scoreStyle(score: number | null | undefined): string {
  const s = score ?? 0;
  if (s >= 70) return "bg-brand-100 text-brand-700";
  if (s >= 40) return "bg-amber-100 text-amber-700";
  return "bg-gray-100 text-gray-500";
}

export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-US");
}
