import { createClient } from "@/lib/supabase/server";

// أدوات معرفة دور المستخدم الحالي (تُستخدم في صفحات الخادم)

export type UserRole = "admin" | "employee";

// جلب دور المستخدم الحالي من جدول profiles
export async function getUserRole(): Promise<UserRole> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return "employee";

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return data?.role === "admin" ? "admin" : "employee";
}

// اختصار: هل المستخدم الحالي مدير؟
export async function isAdmin(): Promise<boolean> {
  return (await getUserRole()) === "admin";
}
