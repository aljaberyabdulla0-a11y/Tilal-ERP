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
//
// ⚠️ التجميع في القاعدة (money_overview — sql/112): كان هنا جلبٌ لكل
//    journal_lines وجمعٌ في TypeScript، وحدّ PostgREST ١٠٠٠ صفّ كان
//    سينقص الأرقام بصمت بعده. والشهر بتوقيت بغداد لا الخادم.
// ============================================================

import { toMoneyOverview, type MoneyOverview, type RawOverview } from "@/lib/money-overview";
export type { Bucket, MoneyOverview } from "@/lib/money-overview";

export async function getMoneyOverview(): Promise<MoneyOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("money_overview", { p_today: baghdadDate() });
  if (error) throw new Error("تعذّر حساب الملخّص المالي: " + error.message);
  return toMoneyOverview((data ?? {}) as RawOverview);
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
