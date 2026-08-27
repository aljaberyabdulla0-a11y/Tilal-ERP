import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import type {
  BrokerCommission,
  BrokerCompany,
  BrokerCompanyProject,
  BrokerPayment,
  BrokerUser,
  Client,
} from "@/lib/types";
import { commissionStatus, leadDaysLeft } from "@/lib/types";

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

// المدفوع لكل عمولة: معرّف العمولة ← مجموع دفعاتها
export function paidByCommission(
  payments: BrokerPayment[]
): Map<string, number> {
  const map = new Map<string, number>();
  payments.forEach((p) => {
    map.set(p.commission_id, (map.get(p.commission_id) ?? 0) + Number(p.amount));
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
    deals: commissions.length,
  };
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
