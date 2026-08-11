import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canSeeTeam, getCurrentUser } from "@/lib/auth";
import { getMySupervisedProjects, getTeamMembers } from "@/lib/projects";
import {
  Attendance,
  Client,
  CompanySettings,
  Leave,
  PIPELINE_STAGE_COLORS,
  formatTime,
  nameKey,
  sinceColor,
  sinceLabel,
} from "@/lib/types";
import {
  companySchedule,
  evaluateDay,
  formatDurationShort,
  todayISO,
} from "@/lib/attendance";
import LeaveDecision from "../hr/leave-decision";

// ============================================================
// «فريقي» — شاشة المشرف.
//
// كل استعلام هنا بلا شرط على الفريق عمداً: سياسات RLS تُرجع نطاق
// المشرف وحده (sql/037). لو أضفنا الفلترة في الشيفرة أيضاً لصار
// عندنا مصدرا حقيقة، وأحدهما سينسى يوماً.
// ============================================================
export default async function TeamPage() {
  if (!(await canSeeTeam())) redirect("/dashboard");

  const supabase = await createClient();
  const today = todayISO();
  const user = await getCurrentUser();

  const [members, projects, { data: cData }, { data: aData }, { data: lData }, { data: cfg }] =
    await Promise.all([
      getTeamMembers(),
      getMySupervisedProjects(),
      supabase
        .from("clients")
        .select("*")
        .order("follow_up_date", { ascending: true, nullsFirst: false }),
      supabase.from("attendance").select("*").eq("work_date", today),
      supabase
        .from("leaves")
        .select("*")
        .eq("status", "معلقة")
        .order("start_date"),
      supabase.from("company_settings").select("*").eq("id", 1).maybeSingle(),
    ]);

  const clients = (cData ?? []) as Client[];
  const attendance = (aData ?? []) as Attendance[];
  const pending = (lData ?? []) as Leave[];
  const settings = (cfg as CompanySettings) ?? null;
  const schedule = companySchedule(settings);

  // نستثني نفسي من قائمة الفريق المعروضة — الشاشة عن من أشرف عليهم
  const myEmployeeId = members.find((m) => m.user_id === user?.id)?.id ?? null;
  const team = members.filter((m) => m.id !== myEmployeeId);

  // ليدات كل عضو: المطابقة بمفتاح الاسم لا بالحرف، تماماً كما في القاعدة
  const clientsOf = (fullName: string) =>
    clients.filter((c) => nameKey(c.sales_employee) === nameKey(fullName));

  const openClients = clients.filter(
    (c) => !["بيع", "فشل البيع"].includes(c.stage ?? "ليد")
  );
  const overdue = openClients.filter(
    (c) => c.follow_up_date && c.follow_up_date < today
  );
  const dueToday = openClients.filter((c) => c.follow_up_date === today);

  const presentNow = team.filter((m) =>
    attendance.some((a) => a.employee_id === m.id && a.check_in)
  ).length;

  const kpi = "glass-card border-s-4 p-5";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">فريقي</h1>
            <p className="text-sm text-gray-500">
              {projects.length > 0
                ? `مشرف على: ${projects.map((p) => p.name).join(" · ")}`
                : "لم يُسنَد لك مشروع بعد — راجع المدير."}
            </p>
          </div>
        </div>
      </header>

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className={kpi + " border-s-brand-500"}>
            <span className="text-sm text-gray-500">أعضاء الفريق</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{team.length}</p>
          </div>
          <div className={kpi + " border-s-green-500"}>
            <span className="text-sm text-gray-500">حاضرون اليوم</span>
            <p className="mt-1 text-2xl font-bold text-green-700">
              {presentNow} / {team.length}
            </p>
          </div>
          <div className={kpi + " border-s-red-500"}>
            <span className="text-sm text-gray-500">متابعات متأخرة</span>
            <p className="mt-1 text-2xl font-bold text-red-700">{overdue.length}</p>
          </div>
          <div className={kpi + " border-s-amber-500"}>
            <span className="text-sm text-gray-500">متابعات اليوم</span>
            <p className="mt-1 text-2xl font-bold text-amber-700">{dueToday.length}</p>
          </div>
        </div>

        {/* طلبات الإجازة المعلّقة */}
        {pending.length > 0 && (
          <div className="glass-card p-5">
            <h3 className="mb-3 text-lg font-bold text-gray-800">
              طلبات إجازة تنتظر قرارك ({pending.length})
            </h3>
            <div className="space-y-2">
              {pending.map((l) => {
                const who = members.find((m) => m.id === l.employee_id);
                const mine = l.employee_id === myEmployeeId;
                return (
                  <div
                    key={l.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
                  >
                    <div className="text-sm">
                      <b className="text-gray-800">{who?.full_name ?? "—"}</b>
                      <span className="text-gray-500">
                        {" · "}
                        {l.leave_type} · {l.start_date}
                        {l.end_date !== l.start_date && ` ← ${l.end_date}`}
                      </span>
                      {l.reason && (
                        <span className="block text-xs text-gray-400">{l.reason}</span>
                      )}
                    </div>
                    {mine ? (
                      <span className="text-xs text-gray-400">
                        طلبك أنت — يبتّه المدير
                      </span>
                    ) : (
                      <LeaveDecision leaveId={l.id} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* أعضاء الفريق */}
        {team.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا يوجد أعضاء في فريقك بعد. المدير يُسند الموظفين للمشروع من صفحة
            المشاريع.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الموظف</th>
                  <th className="px-4 py-3 font-medium">دوام اليوم</th>
                  <th className="px-4 py-3 font-medium">عملاؤه</th>
                  <th className="px-4 py-3 font-medium">مفتوحة</th>
                  <th className="px-4 py-3 font-medium">متابعات متأخرة</th>
                  <th className="px-4 py-3 font-medium">آخر تواصل</th>
                </tr>
              </thead>
              <tbody>
                {team.map((m) => {
                  const mine = clientsOf(m.full_name);
                  const open = mine.filter(
                    (c) => !["بيع", "فشل البيع"].includes(c.stage ?? "ليد")
                  );
                  const late = open.filter(
                    (c) => c.follow_up_date && c.follow_up_date < today
                  );
                  const record =
                    attendance.find((a) => a.employee_id === m.id) ?? null;
                  const day = evaluateDay(
                    today,
                    record,
                    [],
                    schedule,
                    today,
                    m.exempt_from_attendance
                  );
                  const lastContact = mine
                    .map((c) => c.last_contact_at)
                    .filter(Boolean)
                    .sort()
                    .pop();

                  return (
                    <tr key={m.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-800">{m.full_name}</span>
                        <span className="block text-xs text-gray-400">
                          {m.job_title || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${day.statusColor}`}
                        >
                          {day.statusLabel}
                        </span>
                        {record?.check_in && (
                          <span className="mt-0.5 block text-xs text-gray-400" dir="ltr">
                            {formatTime(record.check_in)}
                            {record.check_out && ` ← ${formatTime(record.check_out)}`}
                            {day.workedMinutes
                              ? ` (${formatDurationShort(day.workedMinutes)})`
                              : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-800">
                        {mine.length}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{open.length}</td>
                      <td className="px-4 py-3">
                        {late.length > 0 ? (
                          <span className="font-bold text-red-700">{late.length}</span>
                        ) : (
                          <span className="text-green-600">✓</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className={sinceColor(lastContact ?? null)}>
                          {sinceLabel(lastContact ?? null)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* متابعات الفريق المتأخرة */}
        {overdue.length > 0 && (
          <div className="glass-card p-5">
            <h3 className="mb-1 text-lg font-bold text-gray-800">
              متابعات متأخرة في فريقك
            </h3>
            <p className="mb-4 text-sm text-gray-500">
              فات موعدها ولم يتواصل أحد بعد. اضغط اسم العميل لفتح ملفه.
            </p>
            <div className="space-y-2">
              {overdue.slice(0, 25).map((c) => (
                <Link
                  key={c.id}
                  href={`/dashboard/clients/${c.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 transition hover:bg-gray-50"
                >
                  <div>
                    <b className="text-gray-800">{c.name}</b>
                    <span
                      className={`ms-2 rounded-full px-2 py-0.5 text-xs ${
                        PIPELINE_STAGE_COLORS[c.stage ?? "ليد"] ??
                        "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {c.stage ?? "ليد"}
                    </span>
                    <span className="block text-xs text-gray-400">
                      {c.sales_employee || "غير مسند"}
                      {c.phone && ` · ${c.phone}`}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-red-600" dir="ltr">
                    {c.follow_up_date}
                  </span>
                </Link>
              ))}
              {overdue.length > 25 && (
                <p className="text-xs text-gray-400">
                  و{overdue.length - 25} غيرها — راجعها من صفحة العملاء.
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
