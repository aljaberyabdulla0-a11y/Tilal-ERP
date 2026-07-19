import { createClient } from "@/lib/supabase/server";
import { Account } from "@/lib/types";

// رصيد حساب: مجموع المدين ومجموع الدائن والرصيد الصافي (مدين - دائن)
export type AccountBalance = {
  id: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number; // debit - credit (موجب = رصيد مدين)
};

// يحسب أرصدة كل الحسابات من سطور القيود
export async function getAccountBalances(): Promise<AccountBalance[]> {
  const supabase = await createClient();

  const [{ data: accounts }, { data: lines }] = await Promise.all([
    supabase.from("accounts").select("*").order("code"),
    supabase.from("journal_lines").select("account_id, debit, credit"),
  ]);

  const map: Record<string, AccountBalance> = {};
  (accounts ?? []).forEach((a: Account) => {
    map[a.id] = {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      debit: 0,
      credit: 0,
      balance: 0,
    };
  });

  (lines ?? []).forEach(
    (l: { account_id: string; debit: number; credit: number }) => {
      const acc = map[l.account_id];
      if (!acc) return;
      acc.debit += l.debit ?? 0;
      acc.credit += l.credit ?? 0;
    }
  );

  const list = Object.values(map);
  list.forEach((a) => (a.balance = a.debit - a.credit));
  return list.sort((x, y) => x.code.localeCompare(y.code));
}

// صافي ربح الفترة = الإيرادات - المصروفات
export function computeNetProfit(balances: AccountBalance[]): number {
  const revenue = balances
    .filter((a) => a.type === "revenue")
    .reduce((s, a) => s + (a.credit - a.debit), 0);
  const expense = balances
    .filter((a) => a.type === "expense")
    .reduce((s, a) => s + (a.debit - a.credit), 0);
  return revenue - expense;
}
