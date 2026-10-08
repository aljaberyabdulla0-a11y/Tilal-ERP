import Link from "next/link";
import { baghdadDate } from "@/lib/time";
import { addDays } from "@/lib/tasks";
import { getTaskLookups, getTaskOverview } from "@/lib/tasks-server";
import { KpiGrid, NotReady } from "@/components/tasks/work-center-ui";

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================
// تقارير المهام — من task_overview (193): كل رقم محسوب في القاعدة
// وبنطاق السائل (الموظف يرى أرقامه، المشرف فريقه، المدير الكل).
// كل صفّ ينزل إلى القائمة بنفس المرشّح.
//
// لا «إنتاجية» مطلقة: عدد، نسبة، متوسط زمن، تأخير — بيانات موضوعية
// تُقرأ مع سياقها لا مؤشراً وحيداً للأداء.
// ============================================================
export default async function TaskReportsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const today = baghdadDate();
  const sp = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : "");
  const from = DAY.test(sp("from")) ? sp("from") : addDays(today, -30);
  const to = DAY.test(sp("to")) ? sp("to") : today;
  const dept = UUID.test(sp("dept")) ? sp("dept") : "";
  const source = /^[a-z_]+$/.test(sp("source")) ? sp("source") : "";

  const [lookups, ov] = await Promise.all([
    getTaskLookups(),
    getTaskOverview(from, to, { ...(dept ? { department_id: dept } : {}), ...(source ? { task_source: [source] } : {}) }),
  ]);

  const drill = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ view: "list", ...(dept ? { dept } : {}), ...(source ? { source } : {}), ...extra });
    return `/dashboard/tasks?${q.toString()}`;
  };
  const t = ov?.totals;
  const onTimeRate = t && t.on_time + t.late_done ? Math.round((100 * t.on_time) / (t.on_time + t.late_done)) : null;

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <nav className="mb-2 text-sm text-gray-500" aria-label="مسار التنقّل">
        <Link href="/dashboard/tasks" className="hover:text-brand-700">المهام</Link> ‹ التقارير
      </nav>
      <h1 className="mb-4 text-2xl font-bold text-ink sm:text-3xl">تقارير المهام</h1>

      {!lookups.ready && <NotReady />}

      <form className="dash-card mb-5 flex flex-wrap items-end gap-3 p-3" method="get">
        <label className="text-xs font-semibold text-gray-500">من
          <input type="date" name="from" defaultValue={from} className="mt-1 block rounded-lg border border-gray-300 px-2.5 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-gray-500">إلى
          <input type="date" name="to" defaultValue={to} className="mt-1 block rounded-lg border border-gray-300 px-2.5 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-gray-500">القسم
          <select name="dept" defaultValue={dept} className="mt-1 block rounded-lg border border-gray-300 px-2.5 py-2 text-sm">
            <option value="">كل ما أراه</option>
            {lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.parent_id ? "— " : ""}{d.name_ar}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-500">المصدر
          <select name="source" defaultValue={source} className="mt-1 block rounded-lg border border-gray-300 px-2.5 py-2 text-sm">
            <option value="">كل المصادر</option>
            {lookups.sources.map((s) => <option key={s.code} value={s.code}>{s.name_ar}</option>)}
          </select>
        </label>
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">عرض</button>
      </form>

      {!ov || !t ? (
        <p className="text-sm text-gray-500">تعذّر تحميل التقرير.</p>
      ) : (
        <>
          <KpiGrid items={[
            { label: "أُنشئت", value: t.created, icon: "add_task", tone: "bg-brand-50 text-brand-700" },
            { label: "أُنجزت", value: t.completed, icon: "task_alt", tone: "bg-emerald-50 text-emerald-700", href: drill({ status: "منجزة" }) },
            { label: "متأخرة الآن", value: t.overdue_now, icon: "warning", tone: "bg-red-50 text-red-700", href: drill({ bucket: "late" }) },
            { label: "أُلغيت", value: t.cancelled, icon: "cancel", tone: "bg-gray-100 text-gray-700", href: drill({ status: "ملغاة" }) },
            { label: "في الموعد", value: onTimeRate == null ? "—" : `${onTimeRate}%`, icon: "schedule", tone: "bg-amber-50 text-amber-700",
              hint: t.avg_delay_days != null ? `متوسط التأخير ${t.avg_delay_days} يوم` : undefined },
            { label: "متوسط زمن الإنجاز", value: t.avg_completion_hours == null ? "—" : `${t.avg_completion_hours} س`, icon: "timer", tone: "bg-purple-50 text-purple-700",
              hint: t.sla_breaches ? `${t.sla_breaches} تجاوز SLA` : undefined },
          ]} />

          <div className="grid gap-5 xl:grid-cols-2">
            <ReportTable title="حسب القسم" icon="apartment"
              head={["القسم", "أُنشئت", "أُنجزت", "مفتوحة", "متأخرة", "SLA"]}
              rows={ov.by_department.map((d) => ({
                key: d.id ?? "none",
                cells: [d.name, d.created, d.completed, d.open, d.overdue, d.sla_breaches],
                href: d.id ? drill({ dept: d.id, bucket: "open" }) : undefined,
                bad: d.overdue > 0,
              }))} />

            <ReportTable title="حسب الموظف" icon="person"
              note="الأكثر تأخراً أولاً. نسبة الإنجاز = ما أُنجز ÷ (ما أُنجز + المفتوح المستحقّ حتى نهاية المدة)."
              head={["الموظف", "أُسندت", "أُنجزت", "مفتوحة", "متأخرة", "الإنجاز", "متوسط الزمن"]}
              rows={ov.by_employee.map((e) => ({
                key: e.user_id,
                cells: [e.name, e.assigned, e.completed, e.open, e.overdue,
                  e.completion_rate == null ? "—" : `${e.completion_rate}%`,
                  e.avg_completion_hours == null ? "—" : `${e.avg_completion_hours} س`],
                href: drill({ assignee: e.user_id, bucket: "open" }),
                bad: e.overdue > 0,
              }))} />

            <ReportTable title="حسب المصدر" icon="input"
              head={["المصدر", "أُنشئت", "أُنجزت", "مفتوحة"]}
              rows={ov.by_source.map((s) => ({
                key: s.code, cells: [s.name ?? s.code, s.created, s.completed, s.open], href: drill({ source: s.code }),
              }))} />

            <ReportTable title="حسب الأولوية" icon="priority_high"
              head={["الأولوية", "مفتوحة", "متأخرة", "أُنجزت"]}
              rows={ov.by_priority.map((p) => ({
                key: p.priority, cells: [p.priority, p.open, p.overdue, p.completed], href: drill({ priority: p.priority, bucket: "open" }), bad: p.overdue > 0,
              }))} />

            <ReportTable title="حسب النوع" icon="category"
              head={["النوع", "مفتوحة", "أُنجزت"]}
              rows={ov.by_type.map((x) => ({ key: x.code, cells: [x.name ?? x.code, x.open, x.completed], href: drill({ type: x.code }) }))} />

            <ReportTable title="حسب المشروع" icon="foundation"
              head={["المشروع", "مفتوحة", "متأخرة", "أُنجزت"]}
              rows={ov.by_project.map((p) => ({
                key: p.id, cells: [p.name, p.open, p.overdue, p.completed], href: drill({ project: p.id, bucket: "open" }), bad: p.overdue > 0,
              }))} />
          </div>
        </>
      )}
    </main>
  );
}

function ReportTable({ title, icon, head, rows, note }: {
  title: string; icon: string; head: string[]; note?: string;
  rows: { key: string; cells: (string | number)[]; href?: string; bad?: boolean }[];
}) {
  return (
    <section className="dash-card overflow-hidden">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 font-bold text-ink">
        <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-brand-600">{icon}</span>{title}
      </h2>
      {note && <p className="px-4 pt-2 text-[11px] text-ink-muted">{note}</p>}
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-400">لا بيانات في هذه المدة.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-xs text-gray-500">
              <tr>{head.map((h, i) => <th key={h} className={`px-3 py-2 ${i === 0 ? "text-start" : "text-center"}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-line">
                  {r.cells.map((c, i) => (
                    <td key={i} className={`px-3 py-2 ${i === 0 ? "" : "num-tabular text-center"} ${r.bad && i === 4 ? "font-bold text-red-700" : ""}`}>
                      {i === 0 && r.href ? <Link href={r.href} className="font-medium text-brand-700 hover:underline">{c}</Link> : c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
