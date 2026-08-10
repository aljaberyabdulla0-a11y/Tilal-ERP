import { createClient } from "@/lib/supabase/server";
import {
  CashMove,
  DebtRepayment,
  ExternalDebt,
  Partner,
  PartnerSettlement,
  debtStatus,
  isDebtOverdue,
} from "@/lib/types";
import { baghdadDate } from "@/lib/time";

// ============================================================
// الطبقة المبسّطة للمحاسبة.
// الهدف: أرقام جاهزة بلغة بسيطة (كم قبضنا، كم صرفنا، على شنو، مين دفع)
// مصدر الأرقام هو دفتر القيود نفسه، فتشمل تلقائياً رواتب HR
// وعمولات الموظفين ودفعات الفواتير، لا الحركات اليدوية فقط.
// ============================================================

// سطر من دفتر القيود مع تاريخه وذراعه واسم حسابه
export type LedgerRow = {
  debit: number;
  credit: number;
  code: string;
  name: string;
  type: string;
  date: string;
  arm: string;
};

type RawLine = {
  debit: number | null;
  credit: number | null;
  accounts: { code: string; name: string; type: string } | null;
  journal_entries: { entry_date: string; arm: string | null } | null;
};

export async function getLedgerRows(): Promise<LedgerRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("journal_lines")
    .select(
      "debit, credit, accounts(code, name, type), journal_entries(entry_date, arm)"
    );

  // العلاقات المضمّنة تُستنتج كمصفوفات في الأنواع لكنها كائنات وقت التشغيل
  const rows = (data ?? []) as unknown as RawLine[];

  return rows
    .filter((r) => r.accounts && r.journal_entries)
    .map((r) => ({
      debit: r.debit ?? 0,
      credit: r.credit ?? 0,
      code: r.accounts!.code,
      name: r.accounts!.name,
      type: r.accounts!.type,
      date: r.journal_entries!.entry_date,
      arm: r.journal_entries!.arm ?? "غير محدّد",
    }));
}

export type Bucket = { label: string; amount: number };

export type MoneyOverview = {
  cash: number; // الموجود بالصندوق والبنك الآن
  income: number; // إجمالي ما قبضناه
  expense: number; // إجمالي ما صرفناه
  net: number; // الفرق
  payrollDue: number; // رواتب وعمولات مستحقة لم تُدفع بعد (حساب 2300)
  partnerDue: number; // ما تدين به الشركة للشركاء (حساب 2500)
  externalDebtDue: number; // ديون أعطيناها للناس ولم تُستحصل بعد (حساب 1350)
  monthIncome: number;
  monthExpense: number;
  byCategory: Bucket[]; // الصرف حسب نوع المصروف (الأكبر أولاً)
  byArm: Bucket[]; // الصرف حسب الذراع
  months: { label: string; income: number; expense: number }[]; // آخر 6 أشهر
};

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "كانون2", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "ت1", "ت2", "كانون1",
];

export function summarize(rows: LedgerRow[]): MoneyOverview {
  const cash = rows
    .filter((r) => r.code === "1100" || r.code === "1200")
    .reduce((s, r) => s + r.debit - r.credit, 0);

  // الالتزامات: رصيدها دائن (دائن − مدين)
  const liability = (code: string) =>
    rows
      .filter((r) => r.code === code)
      .reduce((s, r) => s + r.credit - r.debit, 0);

  // الأصول: رصيدها مدين (مدين − دائن)
  const asset = (code: string) =>
    rows
      .filter((r) => r.code === code)
      .reduce((s, r) => s + r.debit - r.credit, 0);

  const incomeRows = rows.filter((r) => r.type === "revenue");
  const expenseRows = rows.filter((r) => r.type === "expense");

  const income = incomeRows.reduce((s, r) => s + r.credit - r.debit, 0);
  const expense = expenseRows.reduce((s, r) => s + r.debit - r.credit, 0);

  const thisMonth = monthKey(new Date());
  const inMonth = (r: LedgerRow) => r.date?.slice(0, 7) === thisMonth;

  const monthIncome = incomeRows
    .filter(inMonth)
    .reduce((s, r) => s + r.credit - r.debit, 0);
  const monthExpense = expenseRows
    .filter(inMonth)
    .reduce((s, r) => s + r.debit - r.credit, 0);

  const group = (list: LedgerRow[], key: (r: LedgerRow) => string): Bucket[] => {
    const map: Record<string, number> = {};
    list.forEach((r) => {
      const k = key(r);
      map[k] = (map[k] ?? 0) + r.debit - r.credit;
    });
    return Object.entries(map)
      .map(([label, amount]) => ({ label, amount }))
      .filter((b) => Math.abs(b.amount) > 0.009)
      .sort((a, b) => b.amount - a.amount);
  };

  // آخر 6 أشهر
  const months: MoneyOverview["months"] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    months.push({
      label: MONTH_NAMES[d.getMonth()],
      income: incomeRows
        .filter((r) => r.date?.slice(0, 7) === key)
        .reduce((s, r) => s + r.credit - r.debit, 0),
      expense: expenseRows
        .filter((r) => r.date?.slice(0, 7) === key)
        .reduce((s, r) => s + r.debit - r.credit, 0),
    });
  }

  return {
    cash,
    income,
    expense,
    net: income - expense,
    payrollDue: liability("2300"),
    partnerDue: liability("2500"),
    externalDebtDue: asset("1350"),
    monthIncome,
    monthExpense,
    byCategory: group(expenseRows, (r) => r.name),
    byArm: group(expenseRows, (r) => r.arm),
    months,
  };
}

export async function getMoneyOverview(): Promise<MoneyOverview> {
  return summarize(await getLedgerRows());
}

// ============================================================
// الديون الخارجية — فلوس أعطيناها لناس نشتغل وياهم ونستحصلها لاحقاً.
// المتبقّي على كل شخص = المبلغ المعطى − مجموع ما استحصلناه منه.
// ============================================================

export type DebtRow = ExternalDebt & {
  repayments: DebtRepayment[];
  collected: number;
  remaining: number;
  status: ReturnType<typeof debtStatus>;
  overdue: boolean;
};

export type DebtsState = {
  rows: DebtRow[];
  given: number;      // إجمالي ما أعطيناه
  collected: number;  // إجمالي ما رجع لنا
  outstanding: number; // ما زال في ذمّة الناس
  overdueAmount: number;
  overdueCount: number;
};

export async function getDebtsState(): Promise<DebtsState> {
  const supabase = await createClient();
  const [{ data: dData }, { data: rData }] = await Promise.all([
    supabase.from("external_debts").select("*").order("debt_date", { ascending: false }),
    supabase.from("debt_repayments").select("*").order("pay_date", { ascending: false }),
  ]);

  const debts = (dData ?? []) as ExternalDebt[];
  const repayments = (rData ?? []) as DebtRepayment[];
  const today = baghdadDate();

  const rows: DebtRow[] = debts.map((d) => {
    const mine = repayments.filter((r) => r.debt_id === d.id);
    const collected = mine.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const amount = Number(d.amount ?? 0);
    const status = debtStatus(amount, collected);
    return {
      ...d,
      amount,
      repayments: mine,
      collected,
      remaining: status.remaining,
      status,
      overdue: isDebtOverdue(d, status.remaining, today),
    };
  });

  const sum = (pick: (r: DebtRow) => number) =>
    rows.reduce((s, r) => s + pick(r), 0);

  const overdueRows = rows.filter((r) => r.overdue);

  return {
    rows,
    given: sum((r) => r.amount),
    collected: sum((r) => r.collected),
    outstanding: sum((r) => r.remaining),
    overdueAmount: overdueRows.reduce((s, r) => s + r.remaining, 0),
    overdueCount: overdueRows.length,
  };
}

// ============================================================
// وضع الشركاء — من دفع أكثر، ومن مدين لمن
//
// ما ساهم به الشريك فعلياً =
//     ما دفعه من جيبه على مصاريف الشركة
//   + ما أودعه في صندوق الشركة
//   − ما استرجعه من الشركة
//   + ما دفعه لشريكه كتسوية  −  ما استلمه كتسوية
//
// حصته المستحقة = نسبة شراكته × مجموع ما موّله الشركاء كلهم
// الرصيد = ما ساهم به − حصته   (موجب: له/دائن، سالب: عليه/مدين)
// ============================================================

export type PartnerPosition = Partner & {
  fromPocket: number; // دفع من جيبه على مصاريف
  deposits: number; // أودع في صندوق الشركة
  refunds: number; // استرجع من الشركة
  settledOut: number; // دفع لشريكه
  settledIn: number; // استلم من شريكه
  contributed: number; // صافي مساهمته
  obligation: number; // حصته المستحقة
  net: number; // + له | − عليه
};

export type PartnersState = {
  partners: Partner[];
  moves: CashMove[]; // الحركات المرتبطة بالشركاء فقط
  settlements: PartnerSettlement[];
  positions: PartnerPosition[];
  pool: number; // مجموع ما موّله الشركاء من جيوبهم
  creditor?: PartnerPosition;
  debtor?: PartnerPosition;
  settleAmount: number;
};

export async function getPartnersState(): Promise<PartnersState> {
  const supabase = await createClient();
  const [{ data: pData }, { data: mData }, { data: sData }] = await Promise.all([
    supabase.from("partners").select("*").order("created_at"),
    supabase
      .from("cash_moves")
      .select("*")
      .not("partner_id", "is", null)
      .order("move_date", { ascending: false }),
    supabase
      .from("partner_settlements")
      .select("*")
      .order("settlement_date", { ascending: false }),
  ]);

  const partners = (pData ?? []) as Partner[];
  const moves = (mData ?? []) as CashMove[];
  const settlements = (sData ?? []) as PartnerSettlement[];

  const sum = (list: { amount: number }[]) =>
    list.reduce((s, x) => s + Number(x.amount ?? 0), 0);

  const base = partners.map((p) => {
    const mine = moves.filter((m) => m.partner_id === p.id);
    const fromPocket = sum(
      mine.filter((m) => m.direction === "صرف" && m.account_code !== "2500")
    );
    const deposits = sum(
      mine.filter((m) => m.direction === "قبض" && m.account_code === "2500")
    );
    const refunds = sum(
      mine.filter((m) => m.direction === "صرف" && m.account_code === "2500")
    );
    const settledOut = sum(settlements.filter((s) => s.from_partner === p.id));
    const settledIn = sum(settlements.filter((s) => s.to_partner === p.id));

    return {
      ...p,
      fromPocket,
      deposits,
      refunds,
      settledOut,
      settledIn,
      funded: fromPocket + deposits - refunds,
      contributed: fromPocket + deposits - refunds + settledOut - settledIn,
    };
  });

  const pool = base.reduce((s, p) => s + p.funded, 0);

  const positions: PartnerPosition[] = base.map(({ funded, ...p }) => {
    const obligation = (pool * (Number(p.share_percent) || 0)) / 100;
    return { ...p, obligation, net: p.contributed - obligation };
  });

  const creditor = positions.find((p) => p.net > 0.009);
  const debtor = positions.find((p) => p.net < -0.009);

  return {
    partners,
    moves,
    settlements,
    positions,
    pool,
    creditor,
    debtor,
    settleAmount: creditor ? creditor.net : 0,
  };
}
