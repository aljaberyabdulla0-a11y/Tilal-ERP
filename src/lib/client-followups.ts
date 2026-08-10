import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { Client } from "@/lib/types";
import { baghdadDate } from "@/lib/time";
import { buildFollowUps, type FollowUpRow } from "@/lib/crm-reports";

// ============================================================
// متابعات العملاء المستحقة على **المستخدم الحالي**.
//
// لا يوجد أي فلترة بالموظف هنا عن قصد: سياسة الصفوف (RLS) على جدول
// clients تُرجع للموظف عملاءه فقط (أضافهم أو مُسندين له)، وللمدير
// الجميع. فنفس الاستعلام يخدم الاثنين — والحماية داخل القاعدة لا في
// الواجهة.
//
// ملفوفة بـ cache(): صفحة المهام تستدعيها للمؤشرات، والمكوّن يستدعيها
// للعرض — رحلة واحدة للقاعدة في الطلب الواحد.
// ============================================================

export type FollowUpsResult = {
  overdue: FollowUpRow[];   // فات موعدها
  dueToday: FollowUpRow[];  // موعدها اليوم
  total: number;
  ready: boolean;           // false = تعذّرت القراءة (عمود/جدول غير جاهز)
};

export const getMyFollowUps = cache(async (): Promise<FollowUpsResult> => {
  const supabase = await createClient();
  const today = baghdadDate();

  // نجلب المستحق فقط (موعده اليوم أو فات) — لا كل العملاء
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .not("follow_up_date", "is", null)
    .lte("follow_up_date", today)
    .order("follow_up_date", { ascending: true })
    .limit(500);

  if (error) return { overdue: [], dueToday: [], total: 0, ready: false };

  // buildFollowUps تستبعد العملاء المغلقين (بيع / فشل البيع)
  const { overdue, dueToday } = buildFollowUps((data ?? []) as Client[], today);

  return {
    overdue,
    dueToday,
    total: overdue.length + dueToday.length,
    ready: true,
  };
});
