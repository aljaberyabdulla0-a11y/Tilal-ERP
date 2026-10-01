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
  projectId: string | null; // مشروع المتابعة — انظر projectResolver
};

// ============================================================
// مشروع العميل لفرز المتابعات.
//
// العميل نادراً ما يحمل مشروعاً بنفسه (المفضّل أو مشروع الوسيط)، لكن
// كل موظف مبيعات في فريق مشروع (employees.project_id — «الفريق =
// المشروع» منذ 037). فالترتيب: مشروع العميل إن وُجد، وإلا مشروع
// مالكه بالمفتاح (owner_id)، وإلا بالاسم النصّي sales_employee —
// عملاء قدامى بلا owner_id.
// ============================================================
export type MemberLite = { id: string; full_name: string; project_id: string | null };

export function projectResolver(members: MemberLite[]): (c: Client) => string | null {
  const byId = new Map(members.map((m) => [m.id, m.project_id]));
  const byName = new Map(members.map((m) => [m.full_name.trim(), m.project_id]));
  return (c) =>
    c.preferred_project_id ??
    c.project_id ??
    (c.owner_id ? byId.get(c.owner_id) : undefined) ??
    (c.sales_employee ? byName.get(c.sales_employee.trim()) : undefined) ??
    null;
}

// فرق الأيام بين تاريخين بصيغة YYYY-MM-DD
function daysDiff(from: string, to: string): number {
  return Math.round(
    (new Date(to + "T12:00:00Z").getTime() - new Date(from + "T12:00:00Z").getTime()) /
      86400000
  );
}

export function buildFollowUps(
  clients: Client[],
  today = baghdadDate(),
  projectOf: (c: Client) => string | null = () => null
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

    const row: FollowUpRow = { client: c, daysLate, stalled, projectId: projectOf(c) };
    if (daysLate === 0) dueToday.push(row);
    else overdue.push(row);
  }

  overdue.sort((a, b) => b.daysLate - a.daysLate);
  dueToday.sort((a, b) => a.client.name.localeCompare(b.client.name, "ar"));
  return { overdue, dueToday };
}

export type FollowUpProject = { id: string; name: string; count: number };

export type FollowUpsResult = {
  overdue: FollowUpRow[];   // فات موعدها
  dueToday: FollowUpRow[];  // موعدها اليوم
  total: number;
  projects: FollowUpProject[]; // المشاريع التي لها متابعات مستحقة (للفرز)
  noProject: number;           // متابعات لم يُعرف مشروعها
  ready: boolean;           // false = تعذّرت القراءة (عمود/جدول غير جاهز)
};

export const getMyFollowUps = cache(async (): Promise<FollowUpsResult> => {
  const supabase = await createClient();
  const today = baghdadDate();

  // نجلب المستحق فقط (موعده اليوم أو فات) — لا كل العملاء.
  // الموظفون من المنظور الآمن team_members (المشرف ممنوع من employees)،
  // وبلا شرط الحالة: عميلٌ غادر مالكه يبقى على مشروع مالكه.
  const [{ data, error }, membersRes, projectsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("*")
      .not("follow_up_date", "is", null)
      .lte("follow_up_date", today)
      .order("follow_up_date", { ascending: true })
      .limit(500),
    supabase.from("team_members").select("id, full_name, project_id"),
    supabase.from("projects").select("id, name"),
  ]);

  if (error)
    return { overdue: [], dueToday: [], total: 0, projects: [], noProject: 0, ready: false };

  const { overdue, dueToday } = buildFollowUps(
    (data ?? []) as Client[],
    today,
    projectResolver((membersRes.data ?? []) as MemberLite[])
  );

  // عدّ المتابعات لكل مشروع — القائمة لا تعرض إلا ما له متابعات
  const names = new Map(
    ((projectsRes.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])
  );
  const counts = new Map<string, number>();
  let noProject = 0;
  for (const r of [...overdue, ...dueToday]) {
    if (r.projectId && names.has(r.projectId))
      counts.set(r.projectId, (counts.get(r.projectId) ?? 0) + 1);
    else noProject++;
  }
  const projects = Array.from(counts, ([id, count]) => ({ id, name: names.get(id) ?? "", count }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  return {
    overdue,
    dueToday,
    total: overdue.length + dueToday.length,
    projects,
    noProject,
    ready: true,
  };
});
