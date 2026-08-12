// ============================================================
// تعريف أعمدة ملف اكسل العملاء + التحقّق من صحّة كل صف.
// يُستخدم في ثلاثة أماكن: توليد القالب، الاستيراد، والتصدير —
// فيبقى ترتيب الأعمدة وأسماؤها متطابقاً دائماً.
// ============================================================

import {
  ALT_CONTACT_RELATIONS,
  IRAQ_GOVERNORATES,
  PURCHASE_PURPOSES,
  CLIENT_SOURCES,
  PAYMENT_METHODS,
  PIPELINE_STAGES,
  isValidPhone,
} from "@/lib/types";

export type ClientColumn = {
  key: string;            // اسم العمود في قاعدة البيانات
  header: string;         // العنوان العربي في ملف الاكسل
  width: number;
  required?: boolean;
  list?: readonly string[]; // قيم مسموحة (تصير قائمة منسدلة في القالب)
  text?: boolean;         // يُحفظ كنص في الاكسل (يحمي الصفر في بداية الهاتف)
  hint?: string;
};

export const CLIENT_COLUMNS: ClientColumn[] = [
  { key: "name", header: "الاسم", width: 26, required: true, hint: "إلزامي" },
  {
    key: "phone",
    header: "رقم الهاتف",
    width: 18,
    text: true,
    hint: "عراقي 07701234567 أو دولي +971501234567",
  },
  { key: "alt_contact_name", header: "اسم من ينوب عنه", width: 22 },
  {
    key: "alt_contact_phone",
    header: "هاتف من ينوب عنه",
    width: 18,
    text: true,
    hint: "اختياري — عراقي 07… أو دولي +…",
  },
  {
    key: "alt_contact_relation",
    header: "صفة من ينوب عنه",
    width: 16,
    list: ALT_CONTACT_RELATIONS,
  },
  { key: "governorate", header: "المحافظة", width: 18, list: IRAQ_GOVERNORATES },
  { key: "area", header: "المنطقة", width: 20 },
  { key: "purchase_purpose", header: "الغرض من الشراء", width: 16, list: PURCHASE_PURPOSES },
  { key: "source", header: "مصدر العميل", width: 18, list: CLIENT_SOURCES },
  { key: "payment_method", header: "طريقة الدفع", width: 14, list: PAYMENT_METHODS },
  { key: "sales_employee", header: "موظف المبيعات", width: 20 },
  { key: "stage", header: "مرحلة المبيعات", width: 16, list: PIPELINE_STAGES },
  { key: "entry_date", header: "التاريخ", width: 14, hint: "بصيغة YYYY-MM-DD" },
  { key: "notes", header: "ملاحظات", width: 34 },
];

// صفّان جاهزان يظهران في القالب كمثال يُحتذى (يُحذفان قبل الرفع)
export const TEMPLATE_SAMPLE_ROWS: Record<string, string>[] = [
  {
    name: "محمد علي حسن",
    phone: "07701234567",
    governorate: "بغداد",
    area: "المنصور",
    purchase_purpose: "سكن",
    source: "سوشيل ميديا",
    payment_method: "أقساط",
    sales_employee: "أحمد",
    stage: "ليد",
    entry_date: "2026-08-01",
    notes: "يبحث عن شقة بثلاث غرف",
  },
  {
    name: "زينب كاظم",
    phone: "07809876543",
    governorate: "البصرة",
    area: "الجزائر",
    purchase_purpose: "استثمار",
    source: "صديق أو معارف",
    payment_method: "كاش",
    sales_employee: "أحمد",
    stage: "اتصال",
    entry_date: "2026-08-02",
    notes: "",
  },
];

// ===== أدوات تحويل قيم خلايا الاكسل =====

// خلية الاكسل قد تكون نصاً أو رقماً أو تاريخاً أو صيغة — نحوّلها كلها لنص نظيف
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return dateToISO(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    // نتائج الصيغ والنصوص الغنيّة في exceljs
    if ("result" in v) return cellToText(v.result);
    if ("text" in v) return cellToText(v.text);
    if ("richText" in v && Array.isArray(v.richText))
      return (v.richText as { text: string }[]).map((r) => r.text).join("");
    if ("hyperlink" in v) return cellToText(v.text);
  }
  return String(value).trim();
}

function dateToISO(d: Date): string {
  // نستخدم التاريخ بتوقيت UTC لأن اكسل يخزّن التواريخ بلا منطقة زمنية
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

// اكسل يبلع الصفر في بداية الأرقام: 07701234567 يصير 7701234567.
// نعيده كما يجب، وندعم كذلك الصيغة الدولية.
export function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s\-()]/g, "").trim();
  if (!p) return "";
  // 00 هي بادئة الاتصال الدولي في أغلب العالم — نحوّلها إلى +
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (/^9647\d{9}$/.test(p)) p = "+" + p;
  if (/^7\d{9}$/.test(p)) p = "0" + p; // الصفر الذي يبتلعه اكسل
  return p;
}

// التاريخ قد يجي نصاً بصيغ مختلفة — نقبل الشائع منها
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // 01/08/2026 أو 01-08-2026 (يوم/شهر/سنة)
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // رقم تسلسلي من اكسل (أيام منذ 1899-12-30)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 60000) {
      const ms = Math.round((serial - 25569) * 86400000);
      return dateToISO(new Date(ms));
    }
  }
  return null;
}

// ===== التحقّق من صف واحد =====

export type ParsedRow = {
  rowNumber: number;                  // رقم الصف في ملف الاكسل (لعرضه للمستخدم)
  values: Record<string, string | null>;
  errors: string[];
  duplicate?: boolean;                // رقم هاتفه موجود مسبقاً في النظام
};

export function validateRow(
  rowNumber: number,
  raw: Record<string, string>,
  // أسماء الموظفين المسموحة في عمود «موظف المبيعات».
  // مهمّة للأمان: حماية الصفوف تربط العميل بموظفه بمطابقة الاسم حرفياً،
  // فلو كُتب الاسم ناقصاً ما راح يشوف الموظف عميله أبداً.
  employeeNames?: string[]
): ParsedRow {
  const errors: string[] = [];
  const values: Record<string, string | null> = {};

  for (const col of CLIENT_COLUMNS) {
    const text = (raw[col.key] ?? "").trim();

    if (!text) {
      if (col.required) errors.push(`«${col.header}» مطلوب ولا يمكن تركه فارغاً.`);
      values[col.key] = null;
      continue;
    }

    // هاتف العميل وهاتف من ينوب عنه: نفس التحقّق تماماً. الفرق أن
    // الثاني اختياري — والفراغ عولج أعلاه فلا يصل إلى هنا أصلاً.
    if (col.key === "phone" || col.key === "alt_contact_phone") {
      const phone = normalizePhone(text);
      if (!isValidPhone(phone)) {
        errors.push(
          `«${col.header}» غير صحيح (${text}) — عراقي: 11 رقماً يبدأ بـ 07 مثل 07701234567. ` +
            `أو دولي بمفتاح الدولة مثل +971501234567.`
        );
        values[col.key] = null;
      } else {
        values[col.key] = phone;
      }
      continue;
    }

    if (col.key === "entry_date") {
      const date = normalizeDate(text);
      if (!date) {
        errors.push(`«${col.header}» غير مفهوم (${text}) — اكتبه بصيغة YYYY-MM-DD.`);
        values[col.key] = null;
      } else {
        values[col.key] = date;
      }
      continue;
    }

    if (col.key === "sales_employee" && employeeNames && employeeNames.length > 0) {
      if (!employeeNames.includes(text)) {
        errors.push(
          `«${col.header}»: (${text}) لا يطابق أي موظف. اكتب الاسم كما هو في ملف الموظفين بالضبط — المتاح: ${employeeNames.join(
            " / "
          )}.`
        );
        values[col.key] = null;
      } else {
        values[col.key] = text;
      }
      continue;
    }

    if (col.list && !col.list.includes(text)) {
      errors.push(
        `«${col.header}»: القيمة (${text}) غير مسموحة. المسموح: ${col.list.join(" / ")}.`
      );
      values[col.key] = null;
      continue;
    }

    values[col.key] = text;
  }

  // المرحلة لها قيمة افتراضية في القاعدة، فلا نرسلها فارغة
  if (!values.stage) values.stage = "ليد";

  return { rowNumber, values, errors };
}
