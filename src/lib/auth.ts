import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// ============================================================
// أدوات معرفة دور المستخدم الحالي (تُستخدم في صفحات الخادم).
//
// كلها ملفوفة بـ cache() من React لسبب مهم للسرعة: الصفحة الواحدة
// تسأل عن الدور من أماكن متعددة (التخطيط + الصفحة + شريط التبويبات)،
// وكل سؤال كان يعني رحلة شبكة لخادم المصادقة ثم رحلة لجدول الأدوار.
// مع cache() تُحسب مرة واحدة لكل طلب وتُعاد بقية المرات فوراً.
// ============================================================

export type UserRole = "admin" | "employee";

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

  return data?.role === "admin" ? "admin" : "employee";
});

// اختصار: هل المستخدم الحالي مدير؟
export const isAdmin = cache(async (): Promise<boolean> => {
  return (await getUserRole()) === "admin";
});
