import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { Client, isClosedStage } from "@/lib/types";
import { baghdadDate } from "@/lib/time";

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
//
// buildFollowUps نُقلت إلى هنا من crm-reports.ts حين استُبدل ذلك
// الملف بدوال القاعدة (sql/076). بقيت لأنها **تقسيم قائمة** لا
// مقياساً: تفرز المستحقّ إلى «اليوم» و«متأخر» — ولا تحسب رقماً
// يُعرض للإدارة.
// ============================================================

export type FollowUpRow = {
  client: Client;
  daysLate: number;      // 0 = اليوم، موجب = متأخر
  stalled: boolean;      // فات الموعد ولا تواصل ولا تحديث بعده
};

// فرق الأيام بين تاريخين بصيغة YYYY-MM-DD
function daysDiff(from: string, to: string): number {
  return Math.round(
    (new Date(to + "T12:00:00Z").getTime() - new Date(from + "T12:00:00Z").getTime()) /
      86400000
  );
}

export function buildFollowUps(
  clients: Client[],
  today = baghdadDate()
): { overdue: FollowUpRow[]; dueToday: FollowUpRow[] } {
  const overdue: FollowUpRow[] = [];
  const dueToday: FollowUpRow[] = [];

  for (const c of clients) {
    if (!c.follow_up_date || isClosedStage(c.stage)) continue;
    const daysLate = daysDiff(c.follow_up_date, today);
    if (daysLate < 0) continue; // موعده لم يحن بعد

    // «متوقّف» = فات الموعد ولم يحصل تواصل بعده
    const lastContactDay = c.last_contact_at ? baghdadDate(c.last_contact_at) : null;
    const stalled =
      daysLate >= 1 && (!lastContactDay || lastContactDay < c.follow_up_date);

    const row: FollowUpRow = { client: c, daysLate, stalled };
    if (daysLate === 0) dueToday.push(row);
    else overdue.push(row);
  }

  overdue.sort((a, b) => b.daysLate - a.daysLate);
  dueToday.sort((a, b) => a.client.name.localeCompare(b.client.name, "ar"));
  return { overdue, dueToday };
}

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

  const { overdue, dueToday } = buildFollowUps((data ?? []) as Client[], today);

  return {
    overdue,
    dueToday,
    total: overdue.length + dueToday.length,
    ready: true,
  };
});
