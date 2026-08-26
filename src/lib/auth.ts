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
  | "supervisor"
  | "followup_manager"
  | "employee";

const ROLES: UserRole[] = [
  "admin",
  "supervisor",
  "followup_manager",
  "employee",
];

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

// اختصار: هل المستخدم الحالي مدير؟
export const isAdmin = cache(async (): Promise<boolean> => {
  return (await getUserRole()) === "admin";
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

// من يدخل قسم المخزون ويعدّل فيه — يطابق can_manage_inventory() في القاعدة.
// ⚠️ لو تغيّرت القاعدة هنا فغيّرها هناك أيضاً، وإلا ظهر زرّ لا يعمل.
export const canManageInventory = cache(async (): Promise<boolean> => {
  const role = await getUserRole();
  return role === "admin" || role === "followup_manager";
});
