// ============================================================
// شكل الملخّص المالي — دالّة خالصة بلا قاعدة، فتُختبر وحدها.
// المصدر: money_overview في القاعدة (sql/112).
// ============================================================

export type Bucket = { label: string; amount: number };

export type MoneyOverview = {
  cash: number; // الموجود بالصندوق والبنك الآن
  income: number; // إجمالي ما قبضناه
  expense: number; // إجمالي ما صرفناه
  net: number; // الفرق
  payrollDue: number; // رواتب وعمولات مستحقة لم تُدفع بعد (حساب 2300)
  partnerDue: number; // ما تدين به الشركة للشركاء (حساب 2500)
  externalDebtDue: number; // ديون أعطيناها للناس ولم تُستحصل بعد (حساب 1350)
  developerDue: number; // عمولات تلال على المطوّرين لم تُحصَّل (حساب 1250)
  monthIncome: number;
  monthExpense: number;
  byCategory: Bucket[]; // الصرف حسب نوع المصروف (الأكبر أولاً)
  byArm: Bucket[]; // الصرف حسب الذراع
  months: { label: string; income: number; expense: number }[]; // آخر 6 أشهر
};

const MONTH_NAMES = [
  "كانون2", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "ت1", "ت2", "كانون1",
];

export type RawOverview = {
  cash?: number; income?: number; expense?: number;
  payrollDue?: number; partnerDue?: number; externalDebtDue?: number; developerDue?: number;
  monthIncome?: number; monthExpense?: number;
  byCategory?: Bucket[]; byArm?: Bucket[];
  months?: { key: string; income: number; expense: number }[];
};

// كائن money_overview من القاعدة ← الشكل الذي تعرضه الصفحات
export function toMoneyOverview(raw: RawOverview): MoneyOverview {
  const n = (v: unknown) => Number(v ?? 0);
  const income = n(raw.income);
  const expense = n(raw.expense);
  const buckets = (list?: Bucket[]) =>
    (list ?? []).map((b) => ({ label: b.label, amount: n(b.amount) }));
  return {
    cash: n(raw.cash),
    income,
    expense,
    net: income - expense,
    payrollDue: n(raw.payrollDue),
    partnerDue: n(raw.partnerDue),
    externalDebtDue: n(raw.externalDebtDue),
    developerDue: n(raw.developerDue),
    monthIncome: n(raw.monthIncome),
    monthExpense: n(raw.monthExpense),
    byCategory: buckets(raw.byCategory),
    byArm: buckets(raw.byArm),
    months: (raw.months ?? []).map((m) => ({
      label: MONTH_NAMES[Number(m.key.slice(5, 7)) - 1] ?? m.key,
      income: n(m.income),
      expense: n(m.expense),
    })),
  };
}
