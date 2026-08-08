import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { Employee } from "@/lib/types";

// جلب ملف الموظف المرتبط بالمستخدم الحالي (أو null إن لم يُربط)
// ملفوف بـ cache(): تُستدعى من التخطيط والصفحة معاً في نفس الطلب
export const getMyEmployee = cache(async (): Promise<Employee | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("employees")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return (data as Employee) ?? null;
});

// ============================================================
// أسماء الموظفين المتاحة لحقل «موظف المبيعات».
// مهمّة للأمان: حماية الصفوف تربط العميل بموظفه بمطابقة الاسم
// حرفياً مع ملف الموظفين — فلو انكتب الاسم ناقصاً ما شاف عميله.
// لذلك نعطي قائمة جاهزة بدل الكتابة الحرة.
//   المدير  → كل الموظفين النشطين.
//   الموظف → اسمه هو فقط.
// ============================================================
export const getSalesEmployeeNames = cache(async (): Promise<string[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("employees")
    .select("full_name")
    .eq("status", "active")
    .order("full_name");

  const names = (data ?? [])
    .map((e: { full_name: string }) => e.full_name?.trim())
    .filter(Boolean);

  // نحذف التكرار (قد يوجد ملفان بنفس الاسم)
  return Array.from(new Set(names));
});
