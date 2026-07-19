import { createClient } from "@/lib/supabase/server";
import { Employee } from "@/lib/types";

// جلب ملف الموظف المرتبط بالمستخدم الحالي (أو null إن لم يُربط)
export async function getMyEmployee(): Promise<Employee | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("employees")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return (data as Employee) ?? null;
}
