import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// ============================================================
// أدوات معرفة دور المستخدم الحالي (تُستخدم في صفحات الخادم).
//
// كلها ملفوفة بـ cache() من React لسبب مهم للسرعة: الصفحة الواحدة
// تسأل عن الدور من أماكن متعددة (التخطيط + الصفحة + شريط التبويبات)،
// وكل سؤال كان يعني رحلة شبكة لخادم المصادقة ثم رحلة لجدول الأدوار.
// مع cache() تُحسب مرة واحدة لكل طلب وتُعاد بقية المرات فوراً.
//
// ⚠️ هذه للواجهة فقط — لإخفاء الأزرار والأقسام. الحماية الحقيقية في
// سياسات RLS داخل القاعدة (sql/036 و sql/037)، فلو تحايل أحد على
// الواجهة لم يحصل على بيانات ليست له.
// ============================================================

export type UserRole =
  | "admin"
  | "accountant"
  | "hr"
  | "supervisor"
  | "followup_manager"
  | "relationship_manager"
  | "broker"
  | "marketing"
  | "viewer"
  | "employee";

const ROLES: UserRole[] = [
  "admin",
  "accountant",
  "hr",
  "supervisor",
  "followup_manager",
  "relationship_manager",
  "broker",
  "marketing",
  "viewer",
  "employee",
];

// ⚠️ لا دور باسم "finance": المالية هي accountant منذ sql/068. دوران
//    بنفس العمل يفترقان مع الوقت فتُمنح صلاحية لأحدهما وتُنسى للآخر.

// المستخدم الحالي — استدعاء واحد لخادم المصادقة لكل طلب
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

// جلب دور المستخدم الحالي من جدول profiles
export const getUserRole = cache(async (): Promise<UserRole> => {
  const user = await getCurrentUser();
  if (!user) return "employee";

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = data?.role as UserRole | undefined;
  // أي قيمة غير معروفة تُعامل كموظف — الأقل صلاحية هو الافتراض الآمن
  return role && ROLES.includes(role) ? role : "employee";
});

// ============================================================
// هل الحساب ما زال على رأس العمل؟
//
// من أُنهيت خدمته يُحظر حسابه في auth، لكن رمزاً كان بيده يبقى
// صالحاً حتى ينتهي أجله — فلا يكفي الحظر وحده لطرده من الشاشات.
// تُقرأ من دالة في القاعدة لا من جدول، فتبقى القاعدة مصدر الحقيقة
// الوحيد وتحكم الاستعلامات كما تحكم الواجهة (sql/045).
// ============================================================
export const isAccountActive = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_account_active");
  // عند تعذّر الفحص نفترض النشاط: عطلٌ في الشبكة يجب ألّا يقفل
  // النظام في وجه الجميع.
  if (error) return true;
  return data !== false;
});

// اختصار: هل المستخدم الحالي مدير؟
export const isAdmin = cache(async (): Promise<boolean> => {
  return (await getUserRole()) === "admin";
});

// ============================================================
// دورا المالية والموارد البشرية — فصل الواجبات (sql/068).
//
// الموارد البشرية **تُحضّر** الكشف، والمحاسب **يعتمده** فيدخل
// الدفاتر. فمن يبني الرقم لا يوقّعه، ومن يوقّعه لا يبنيه.
//
// ⚠️ الثلاث تطابق can_manage_finance() و can_manage_hr() و
//    can_see_payroll() في القاعدة حرفياً. لو تغيّرت هناك فغيّرها
//    هنا، وإلا ظهر زرٌّ لا يعمل أو اختفى زرٌّ يعمل.
// ============================================================
export const isAccountant = cache(async (): Promise<boolean> => {
  return (await getUserRole()) === "accountant";
});

export const isHr = cache(async (): Promise<boolean> => {
  return (await getUserRole()) === "hr";
});

// من يمسّ دفاتر الشركة: يعتمد، ويقفل الفترة، ويحصّل، ويصرف
export const canManageFinance = cache(async (): Promise<boolean> => {
  const role = await getUserRole();
  return role === "admin" || role === "accountant";
});

// من يُحضّر ملفّ الموظف: الكشف والدوام والإجازة والسلفة
export const canManageHr = cache(async (): Promise<boolean> => {
  const role = await getUserRole();
  return role === "admin" || role === "hr";
});

// من يرى أرقام الرواتب — الطرفان معاً
export const canSeePayroll = cache(async (): Promise<boolean> => {
  const role = await getUserRole();
  return role === "admin" || role === "accountant" || role === "hr";
});

// هل هو مشرف؟ (المدير ليس مشرفاً — له صلاحياته الكاملة أصلاً)
export const isSupervisor = cache(async (): Promise<boolean> => {
  return (await getUserRole()) === "supervisor";
});

// من يرى أكثر من نفسه: المدير أو المشرف
export const canSeeTeam = cache(async (): Promise<boolean> => {
  const role = await getUserRole();
  return role === "admin" || role === "supervisor";
});

// هل هو مدير المتابعة؟ (المتابعة التشغيلية اليومية — sql/040)
export const isFollowupManager = cache(async (): Promise<boolean> => {
  return (await getUserRole()) === "followup_manager";
});

// حساب شركة وسيطة خارجية (ليس موظفاً في تلال) — sql/043
export const isBroker = cache(async (): Promise<boolean> => {
  return (await getUserRole()) === "broker";
});

// مدير العلاقات: يتابع الشركات التي تحت مظلته في مشروعه
export const isRelationshipManager = cache(async (): Promise<boolean> => {
  return (await getUserRole()) === "relationship_manager";
});

// من يفتح شاشات الوساطة (الشركات والليدات والعمولات):
// المدير يديرها، ومدير العلاقات يرى نطاقه منها — والقاعدة تفرض النطاق.
export const canSeeBrokers = cache(async (): Promise<boolean> => {
  const role = await getUserRole();
  return role === "admin" || role === "relationship_manager";
});

// ============================================================
// التسويق والمُطالِع — قراءة بلا كتابة (sql/084).
//
// ⚠️ إخفاء الأزرار هنا ليس حمايةً بل صدقاً مع المستخدم. الحماية في
//    القاعدة، لكن لها خاصيّة يجب معرفتها: RLS تمنع التعديل **صمتاً**
//    — صفر صفوف بلا خطأ. فزرٌّ ظاهر لمن لا يملك يُظهر «حُفظ» ولم
//    يُحفظ شيء. لذلك يُخفى الزرّ، لا لأن إظهاره ثغرة بل لأنه كذب.
// ============================================================
export const isMarketing = cache(async (): Promise<boolean> => {
  return (await getUserRole()) === "marketing";
});

export const isViewer = cache(async (): Promise<boolean> => {
  return (await getUserRole()) === "viewer";
});

// يقرأ الـCRM كلّه ولا يكتب فيه — يطابق can_read_all_crm() في القاعدة
export const canReadAllCrm = cache(async (): Promise<boolean> => {
  const role = await getUserRole();
  return role === "marketing" || role === "viewer";
});

// من يملك تعديل بيانات العملاء والفرص. الموظف يملكها على عملائه،
// والتسويق والمُطالِع لا يملكانها على أحد.
export const canWriteCrm = cache(async (): Promise<boolean> => {
  const role = await getUserRole();
  return role !== "marketing" && role !== "viewer" && role !== "broker";
});

// من يدخل قسم المخزون ويعدّل فيه — يطابق can_manage_inventory() في القاعدة.
// ⚠️ لو تغيّرت القاعدة هنا فغيّرها هناك أيضاً، وإلا ظهر زرّ لا يعمل.
export const canManageInventory = cache(async (): Promise<boolean> => {
  const role = await getUserRole();
  return role === "admin" || role === "followup_manager";
});
