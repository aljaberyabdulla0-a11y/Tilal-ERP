import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import type {
  BrokerCommission,
  BrokerCommissionAdjustment,
  BrokerCompany,
  BrokerCompanyProject,
  BrokerDashboardSummary,
  BrokerPayment,
  BrokerPerformanceRow,
  BrokerRequestDetail,
  BrokerReservationRequest,
  BrokerScope,
  BrokerUnit,
  BrokerUser,
  Client,
  CommissionLedgerRow,
  CommissionPlan,
  DirectVsBrokerRow,
  RmPerformanceRow,
  SupervisorApprovalRow,
  SupervisorDashboardRow,
} from "@/lib/types";
import { commissionStatus, leadDaysLeft, planPeriodKey } from "@/lib/types";

// ============================================================
// الوساطة — الشركات وليداتها وعمولاتها.
//
// ⚠️ لا فلترة بالدور في هذا الملف عمداً (نفس مبدأ projects.ts
// و inventory.ts): سياسات sql/043 تُرجع لكل واحد نطاقه — المدير كل
// الشركات، ومدير العلاقات شركاته، والشركة نفسها. نفس الاستعلام يخدم
// الثلاثة، فلا يوجد شرطٌ في شاشة يُنسى فتتسرّب بيانات.
// ============================================================

export const getBrokerCompanies = cache(async (): Promise<BrokerCompany[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("broker_companies")
    .select("*")
    .order("name");
  return (data ?? []) as BrokerCompany[];
});

// شركتي أنا (لحساب الشركة الوسيطة)
export const getMyBrokerCompany = cache(async (): Promise<BrokerCompany | null> => {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const { data: link } = await supabase
    .from("broker_users")
    .select("company_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!link?.company_id) return null;

  const { data } = await supabase
    .from("broker_companies")
    .select("*")
    .eq("id", link.company_id)
    .maybeSingle();

  return (data as BrokerCompany) ?? null;
});

// إسنادات الشركات للمشاريع (ومدير علاقات كل إسناد)
export const getBrokerProjects = cache(async (): Promise<BrokerCompanyProject[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("broker_company_projects")
    .select("*, projects(name), broker_companies(name)");
  return (data ?? []) as BrokerCompanyProject[];
});

// حسابات الدخول التابعة للشركات
export const getBrokerUsers = cache(async (): Promise<BrokerUser[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("broker_users")
    .select("*, broker_companies(name)")
    .order("created_at");
  return (data ?? []) as BrokerUser[];
});

// ليدات الوساطة — كل ما يراه المستخدم الحالي منها
export async function getBrokerLeads(companyId?: string): Promise<Client[]> {
  const supabase = await createClient();
  let query = supabase
    .from("clients")
    .select("*, broker_companies(name), projects(name)")
    .not("broker_company_id", "is", null)
    .order("broker_deadline", { ascending: true, nullsFirst: false });

  if (companyId) query = query.eq("broker_company_id", companyId);

  const { data } = await query;
  return (data ?? []) as Client[];
}

// الليدات التي عادت إلى تلال ولم تُوزَّع بعد — بركة إعادة التوزيع
export async function getReturnedLeads(): Promise<Client[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("*, projects(name)")
    .is("broker_company_id", null)
    .not("returned_at", "is", null)
    .order("returned_at", { ascending: false });
  return (data ?? []) as Client[];
}

export async function getBrokerCommissions(
  companyId?: string
): Promise<BrokerCommission[]> {
  const supabase = await createClient();
  let query = supabase
    .from("broker_commissions")
    .select("*, broker_companies(name), clients(name), units(project, unit_code), projects(name)")
    .order("earned_at", { ascending: false });

  if (companyId) query = query.eq("company_id", companyId);

  const { data } = await query;
  return (data ?? []) as BrokerCommission[];
}

// خطط العمولة وشرائحها (sql/129) — كلٌّ يرى نطاقه: الوسيط خطط «وسيط» في
// مشاريعه (العامة وخاصّته)، والموظف خطط الموظفين، والمشرف والـRM مشاريعهم.
export const getCommissionPlans = cache(async (): Promise<CommissionPlan[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("commission_plans")
    .select("*, commission_plan_tiers(*)")
    .order("created_at", { ascending: false });
  return (data ?? []) as CommissionPlan[];
});

// نطاق الوساطة للمستخدم الحالي — للعرض وحده (الحماية في السياسات)
export const getMyBrokerScope = cache(async (): Promise<BrokerScope> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_broker_scope");
  return (data as BrokerScope) ?? { admin: false, rm: false, supervisor: false, broker: false };
});

// تفاصيل طلب واحد مع خطّه الزمني — null إن لم يكن في نطاق السائل
export async function getBrokerRequestDetail(id: string): Promise<BrokerRequestDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("broker_request_detail", { p_id: id });
  if (error || !data) return null;
  return data as BrokerRequestDetail;
}

export async function getBrokerDashboardSummary(): Promise<BrokerDashboardSummary | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("broker_dashboard_summary");
  return (data as BrokerDashboardSummary) ?? null;
}

export async function getSupervisorBrokerDashboard(): Promise<SupervisorDashboardRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("supervisor_broker_dashboard");
  return (data ?? []) as SupervisorDashboardRow[];
}

// دفتر العمولات الموحّد — RLS المخازن تحكم ما يُرى (security_invoker)
export type LedgerFilters = {
  from?: string;
  to?: string;
  project?: string;
  recipientType?: string;
  recipient?: string;
  status?: string;
  channel?: string;
};

export async function getCommissionLedger(f: LedgerFilters = {}): Promise<CommissionLedgerRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("commission_ledger")
    .select("*")
    .order("earned_at", { ascending: false })
    .limit(1000);
  if (f.from) q = q.gte("earned_at", f.from);
  if (f.to) q = q.lte("earned_at", f.to);
  if (f.project) q = q.eq("project_id", f.project);
  if (f.recipientType) q = q.eq("recipient_type", f.recipientType);
  if (f.recipient) q = q.eq("recipient_id", f.recipient);
  if (f.status) q = q.eq("status", f.status);
  if (f.channel) q = q.eq("sale_channel", f.channel);
  const { data } = await q;
  return (data ?? []) as CommissionLedgerRow[];
}

// ===== تقارير الأداء (sql/130) — كلّها تفحص النطاق في القاعدة =====
type Range = { from?: string | null; to?: string | null; project?: string | null };

export async function getBrokerPerformance(r: Range = {}): Promise<BrokerPerformanceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("broker_performance", {
    p_from: r.from || null, p_to: r.to || null, p_project: r.project || null,
  });
  return (data ?? []) as BrokerPerformanceRow[];
}

export async function getRmPerformance(r: Range = {}): Promise<RmPerformanceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("rm_performance", {
    p_from: r.from || null, p_to: r.to || null, p_project: r.project || null,
  });
  return (data ?? []) as RmPerformanceRow[];
}

export async function getSupervisorApprovalPerformance(r: Range = {}): Promise<SupervisorApprovalRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("supervisor_approval_performance", {
    p_from: r.from || null, p_to: r.to || null,
  });
  return (data ?? []) as SupervisorApprovalRow[];
}

export async function getDirectVsBroker(r: Range = {}): Promise<DirectVsBrokerRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("direct_vs_broker", {
    p_from: r.from || null, p_to: r.to || null,
  });
  return (data ?? []) as DirectVsBrokerRow[];
}

// طلبات الحجز — كلٌّ يرى نطاقه (الإدارة، مدير العلاقات، الشركة)
export async function getBrokerRequests(
  companyId?: string
): Promise<BrokerReservationRequest[]> {
  const supabase = await createClient();
  let query = supabase
    .from("broker_reservation_requests")
    .select("*, broker_companies(name), clients(name, phone), projects(name)")
    .order("created_at", { ascending: false });
  if (companyId) query = query.eq("company_id", companyId);
  const { data } = await query;
  return (data ?? []) as BrokerReservationRequest[];
}

// وحدات الوسيط — عبر الدالّة لا الجدول: سياسة units مغلقة عليه عمداً
export async function getMyBrokerUnits(): Promise<BrokerUnit[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("broker_units");
  return (data ?? []) as BrokerUnit[];
}

export async function getCommissionAdjustments(): Promise<BrokerCommissionAdjustment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("broker_commission_adjustments")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []) as BrokerCommissionAdjustment[];
}

export async function getBrokerPayments(): Promise<BrokerPayment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("broker_payments")
    .select("*")
    .order("payment_date", { ascending: false });
  return (data ?? []) as BrokerPayment[];
}

// ============================================================
// خلاصات محسوبة — دوال خالصة على ما جُلب
// ============================================================

// صافي المدفوع لكل عمولة: دفعات − استرداد (sql/129) — يطابق
// broker_commission_net_paid في القاعدة
export function paidByCommission(
  payments: BrokerPayment[]
): Map<string, number> {
  const map = new Map<string, number>();
  payments.forEach((p) => {
    const signed = p.kind === "استرداد" ? -Number(p.amount) : Number(p.amount);
    map.set(p.commission_id, (map.get(p.commission_id) ?? 0) + signed);
  });
  return map;
}

export type CompanyMoney = {
  earned: number;     // إجمالي المستحق
  paid: number;       // المدفوع فعلاً
  remaining: number;  // الباقي في ذمة تلال
  deals: number;      // عدد الصفقات
};

export function companyMoney(
  commissions: BrokerCommission[],
  paid: Map<string, number>
): CompanyMoney {
  const earned = commissions.reduce((s, c) => s + Number(c.amount), 0);
  const paidTotal = commissions.reduce((s, c) => s + (paid.get(c.id) ?? 0), 0);
  return {
    earned,
    paid: paidTotal,
    remaining: Math.max(0, earned - paidTotal),
    // الصفقة المفسوخة مبلغها صفر وخارج العدّ (sql/117)
    deals: commissions.filter((c) => !c.reversed_at).length,
  };
}

// قياس الشركة في دلو خطّتها للفترة الجارية: عدد صفقاتها أو مجموع قيمها.
// الدلو (الخطة، الشركة، الفترة) — كما يعدّ recompute_broker_bucket.
export function planMeasure(
  commissions: BrokerCommission[],
  plan: Pick<CommissionPlan, "id" | "basis" | "period">,
  companyId: string
): number {
  const key = planPeriodKey(plan.period);
  const inBucket = commissions.filter(
    (c) => !c.reversed_at && c.plan_id === plan.id && c.company_id === companyId && c.period_key === key
  );
  return plan.basis === "قيمة المبيعات"
    ? inBucket.reduce((s, c) => s + Number(c.deal_amount), 0)
    : inBucket.length;
}


export function commissionStatusOf(
  c: BrokerCommission,
  paid: Map<string, number>
) {
  return commissionStatus(Number(c.amount), paid.get(c.id) ?? 0);
}

export type LeadBuckets = {
  active: Client[];    // ضمن المهلة
  urgent: Client[];    // باقٍ ٣ أيام أو أقل
  expired: Client[];   // انتهت مهلته ولم يُرجعه الفحص بعد
  closed: Client[];    // أُغلق بيعاً — لا مهلة عليه
};

// تصنيف الليدات حسب مهلتها — ترتيب الإلحاح هو ترتيب العرض
export function bucketLeads(leads: Client[]): LeadBuckets {
  const buckets: LeadBuckets = { active: [], urgent: [], expired: [], closed: [] };

  leads.forEach((l) => {
    if (l.stage === "بيع") {
      buckets.closed.push(l);
      return;
    }
    const days = leadDaysLeft(l.broker_deadline);
    if (days === null) buckets.active.push(l);
    else if (days < 0) buckets.expired.push(l);
    else if (days <= 3) buckets.urgent.push(l);
    else buckets.active.push(l);
  });

  return buckets;
}
