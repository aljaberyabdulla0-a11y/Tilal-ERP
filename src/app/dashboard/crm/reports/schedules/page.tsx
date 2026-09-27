import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { baghdadDate, baghdadTime } from "@/lib/time";
import { getReportTemplates, getSchedules, MANAGE_ROLES } from "@/lib/crm-reporting";
import CrmTabs from "../../crm-tabs";
import ScheduleForm, { ScheduleRowActions, type ScheduleDraft } from "./schedule-form";

// ============================================================
// التقارير المجدولة (§41).
//
// الإدارة ومدير المتابعة يجدولون ويديرون الكل؛ المشرف يجدول لنفسه
// ويدير ما جدوله (سياسة 099). والمستلم يرى الجدولة التي هو فيها.
//
// ⚠️ لا بريد: النظام بلا خادم إرسال. التسليم إشعارٌ داخلي برابط.
//    ربط البريد لاحقاً يمسّ crm_run_due_report_schedules وحدها.
// ============================================================

const FREQ: Record<string, string> = { daily: "يومياً", weekly: "أسبوعياً", monthly: "شهرياً" };
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export default async function Schedules({ searchParams }: { searchParams: { template?: string; edit?: string } }) {
  const role = await getUserRole();
  const canWrite = MANAGE_ROLES.includes(role) || role === "supervisor";
  if (!canWrite) redirect("/dashboard/crm/reports");

  const supabase = await createClient();
  const [schedules, templates, members, profiles] = await Promise.all([
    getSchedules(),
    getReportTemplates(),
    supabase.from("team_members").select("user_id, full_name").not("user_id", "is", null).eq("status", "active").order("full_name"),
    supabase.from("profiles").select("id, email, role").in("role", ["admin", "followup_manager", "supervisor", "employee", "marketing", "viewer", "accountant"]),
  ]);

  const nameByUser = new Map(((members.data ?? []) as { user_id: string; full_name: string }[]).map((m) => [m.user_id, m.full_name]));
  const people = ((profiles.data ?? []) as { id: string; email: string | null; role: string }[])
    .map((p) => ({ id: p.id, label: nameByUser.get(p.id) ?? p.email ?? p.id.slice(0, 8) }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));
  const runnable = templates.filter((t) => !t.definition.link);
  const templateName = new Map(templates.map((t) => [t.id, t.name]));

  const editing = searchParams.edit ? schedules.find((s) => s.id === searchParams.edit) : null;
  const startTemplate = runnable.find((t) => t.id === searchParams.template) ?? runnable[0];
  const initial: ScheduleDraft = editing
    ? { ...editing, run_time: editing.run_time.slice(0, 5), filters: editing.filters ?? {} }
    : {
        template_id: startTemplate?.id ?? "", name: startTemplate ? `${startTemplate.name} — يومي` : "",
        frequency: "daily", run_time: "08:30", weekday: null, month_day: null, range_preset: "yesterday",
        compare: "previous_period", recipients: [], format: "view", is_active: true, filters: {},
      };

  return (
    <div>
      <CrmTabs active="reports" />
      <div className="space-y-6 p-6">
        <header>
          <Link href="/dashboard/crm/reports" className="text-sm text-brand-700 hover:underline">← التقارير</Link>
          <h1 className="mt-1 text-xl font-bold text-brand-600">التقارير المجدولة</h1>
          <p className="mt-1 text-sm text-gray-500">
            يصل إشعارٌ للمستلمين في الموعد برابط التقرير بمداه المحسوم. الأرقام تُحسب عند الفتح بصلاحية من يفتح.
          </p>
        </header>

        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-3 font-bold text-gray-800">{editing ? `تعديل «${editing.name}»` : "جدولة جديدة"}</h2>
          {runnable.length === 0 ? <p className="text-sm text-gray-400">لا قوالب.</p> : (
            <ScheduleForm key={editing?.id ?? searchParams.template ?? "new"} templates={runnable.map((t) => ({ id: t.id, name: t.name }))} people={people} initial={initial} />
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white">
          <h2 className="border-b px-5 py-3 font-bold text-gray-800">الجدولات</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>{["الاسم", "التقرير", "الموعد", "المدى", "المستلمون", "آخر إرسال", "القادم", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {schedules.map((s) => (
                  <tr key={s.id} className={s.is_active ? "" : "text-gray-400"}>
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2">{templateName.get(s.template_id) ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {FREQ[s.frequency]} {s.run_time.slice(0, 5)}
                      {s.frequency === "weekly" && s.weekday !== null ? ` · ${DAYS[s.weekday]}` : ""}
                      {s.frequency === "monthly" && s.month_day ? ` · يوم ${s.month_day}` : ""}
                    </td>
                    <td className="px-3 py-2 text-xs">{s.range_preset}</td>
                    <td className="px-3 py-2 text-xs">{s.recipients.length}</td>
                    <td className="px-3 py-2 text-xs">
                      {s.last_run_at ? `${baghdadDate(s.last_run_at)} ${baghdadTime(s.last_run_at)}` : "—"}
                      {s.last_status === "failed" && <span className="ms-1 text-red-700" title={s.last_error ?? ""}>فشل</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">{s.is_active && s.next_run_at ? `${baghdadDate(s.next_run_at)} ${baghdadTime(s.next_run_at)}` : "موقوف"}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex gap-3 text-xs">
                        <Link href={`/dashboard/crm/reports/schedules?edit=${s.id}`} className="text-gray-700 hover:underline">تعديل</Link>
                        <ScheduleRowActions id={s.id} active={s.is_active} />
                      </span>
                    </td>
                  </tr>
                ))}
                {schedules.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">لا جدولات بعد.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
