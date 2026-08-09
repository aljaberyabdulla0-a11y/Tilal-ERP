import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { ChatPerson } from "@/lib/types";

// ============================================================
// دليل المستخدمين — كل من له حساب دخول في النظام مع اسمه المعروض.
//
// الاسم يُؤخذ من ملف الموظف (employees.full_name) إن كان الحساب مربوطاً،
// وإلا من الجزء الأول من البريد — نفس القاعدة المستخدمة داخل قاعدة
// البيانات في دالة display_name، حتى لا يختلف الاسم بين مكان وآخر.
//
// ملفوفة بـ cache(): تُستدعى من أكثر من مكان في نفس الطلب
// (نموذج المهام + قائمة المحادثات) فتُحسب مرة واحدة.
// ============================================================
export const getPeople = cache(async (): Promise<ChatPerson[]> => {
  const supabase = await createClient();

  const [{ data: profiles }, { data: employees }] = await Promise.all([
    supabase.from("profiles").select("id, email, role").order("created_at"),
    supabase.from("employees").select("user_id, full_name").not("user_id", "is", null),
  ]);

  const names = new Map<string, string>();
  (employees ?? []).forEach((e: { user_id: string | null; full_name: string }) => {
    if (e.user_id && e.full_name?.trim()) names.set(e.user_id, e.full_name.trim());
  });

  return (profiles ?? []).map(
    (p: { id: string; email: string | null; role: string }) => ({
      user_id: p.id,
      name: names.get(p.id) || (p.email ? p.email.split("@")[0] : "مستخدم"),
      email: p.email,
      role: p.role,
    })
  );
});

// خريطة سريعة: معرّف المستخدم ← اسمه
export const getPeopleMap = cache(async (): Promise<Map<string, string>> => {
  const people = await getPeople();
  return new Map(people.map((p) => [p.user_id, p.name]));
});
