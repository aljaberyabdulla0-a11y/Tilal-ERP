import { createClient } from "@/lib/supabase/server";

// رصيد حساب لفترة: افتتاحي قبل from، ومدين ودائن الفترة، وختامي حتى to
export type AccountBalance = {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  opening: number; // مدين − دائن قبل بداية الفترة
  debit: number; // مدين الفترة
  credit: number; // دائن الفترة
  balance: number; // الختامي حتى نهاية الفترة (موجب = رصيد مدين)
};

export type Period = { from?: string; to?: string };

// الأرصدة من القاعدة (account_balances — sql/112): تجميعٌ هناك لا هنا،
// فلا حدّ ١٠٠٠ صفّ ينقص الأرقام بصمت. بلا فترة = كل الزمن.
export async function getAccountBalances(period: Period = {}): Promise<AccountBalance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("account_balances", {
    p_from: period.from || null,
    p_to: period.to || null,
  });
  if (error) throw new Error("تعذّر حساب أرصدة الحسابات: " + error.message);

  type Row = {
    account_id: string; code: string; name: string; type: string; is_active: boolean;
    opening: number; debit: number; credit: number; closing: number;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.account_id,
    code: r.code,
    name: r.name,
    type: r.type,
    isActive: r.is_active,
    opening: Number(r.opening),
    debit: Number(r.debit),
    credit: Number(r.credit),
    balance: Number(r.closing),
  }));
}

// صافي ربح الفترة = إيرادات الفترة − مصروفاتها (حركة الفترة لا الرصيد)
export function computeNetProfit(balances: AccountBalance[]): number {
  const revenue = balances
    .filter((a) => a.type === "revenue")
    .reduce((s, a) => s + (a.credit - a.debit), 0);
  const expense = balances
    .filter((a) => a.type === "expense")
    .reduce((s, a) => s + (a.debit - a.credit), 0);
  return revenue - expense;
}

// من أين جاء القيد الآلي — اسم المصدر بالعربي، ليُعرض بدل اسم الجدول
export const JOURNAL_SOURCE_LABELS: Record<string, string> = {
  cash_moves: "حركة مالية",
  commissions: "عمولة موظف",
  reservations: "عمولة صفقة",
  sale_commissions: "تحصيل عمولة صفقة",
  payrolls: "كشف راتب",
  payroll_payments: "دفعة راتب",
  employee_advances: "سلفة موظف",
  external_debts: "دين خارجي",
  debt_repayments: "استحصال دين",
  inventory_moves: "شراء مخزون",
  broker_payments: "دفعة شركة وسيطة",
};

export function journalSourceLabel(source: string | null): string {
  if (!source) return "قيد يدوي";
  return JOURNAL_SOURCE_LABELS[source] ?? source;
}
