import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserRole } from "@/lib/auth";
import { baghdadDate, baghdadTime } from "@/lib/time";
import {
  getFactReconcile, getMetricDefs, getSnapshotCorrections, getSnapshotRunDetail, getSnapshotRuns,
  getSnapshotStatus, MANAGE_ROLES,
} from "@/lib/crm-reporting";
import { fmtNum } from "@/lib/report-engine";
import { addDays } from "@/lib/report-dates";
import { SEVERITY_STYLE } from "@/lib/crm-style";
import CrmTabs from "../../crm-tabs";
import { BackfillForm, RebuildForm, ResyncFacts, RunSnapshotButton } from "./snapshot-actions";

// ============================================================
// عمليات اللقطات (§43 · §45 · §46 · §67 · §68).
//
// ما يجب أن يُرى بنظرة: هل أُخذت لقطة الأمس؟ متى القادمة؟ هل فشل شيء
// ولماذا — المرحلة والرسالة كما سجّلتها القاعدة؟ وهل الأحداث تطابق
// أصلها؟ ثم سجلّ كل تشغيل، وتفصيل أيّ تشغيل: تحذيراته، وخطؤه، وملخّصه،
// والأصل مقابل المصحَّح إن أُعيد بناؤه.
// ============================================================

const TRIGGER: Record<string, string> = { cron: "مجدول", manual: "يدوي", retry: "إعادة", rebuild: "إعادة بناء", backfill: "استدراك", test: "اختبار" };
const STATUS: Record<string, [string, string]> = {
  completed: ["مكتملة", "bg-brand-100 text-brand-800"],
  completed_with_warnings: ["مكتملة بتحذيرات", "bg-amber-100 text-amber-800"],
  failed: ["فشلت", "bg-red-100 text-red-800"],
  running: ["تعمل", "bg-blue-100 text-blue-800"],
  pending: ["بالانتظار", "bg-gray-100 text-gray-700"],
};

export default async function SnapshotOps({ searchParams }: { searchParams: { run?: string } }) {
  const role = await getUserRole();
  if (!MANAGE_ROLES.includes(role)) redirect("/dashboard/crm/reports");
  const admin = role === "admin";

  const [status, runs, reconcile, defs] = await Promise.all([getSnapshotStatus(), getSnapshotRuns(90), getFactReconcile(), getMetricDefs()]);
  const today = baghdadDate();
  const detail = searchParams.run ? await getSnapshotRunDetail(searchParams.run) : null;
  const corrections = detail ? await getSnapshotCorrections(String(detail.snapshot_date)) : [];
  const nameOf = new Map(defs.map((m) => [m.code, m.name_ar]));

  return (
    <div>
      <CrmTabs active="reports" />
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/dashboard/crm/reports" className="text-sm text-brand-700 hover:underline">← التقارير</Link>
            <h1 className="mt-1 text-xl font-bold text-brand-600">عمليات اللقطات</h1>
            <p className="mt-1 text-sm text-gray-500">
              صورة الـCRM في نهاية كل يوم بغداد — تُؤخذ {status ? `${String(status.schedule.hour).padStart(2, "0")}:${String(status.schedule.minute).padStart(2, "0")}` : "٩:٠٠"} لليوم السابق،
              ولا تُعاد حسابها من الحالة الراهنة.
            </p>
          </div>
          <Link href="/dashboard/settings/crm" className="text-sm text-gray-500 hover:text-brand-700">الوقت والمحاولات والاحتفاظ ← إعدادات الـCRM</Link>
        </header>

        {status && (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card title="آخر لقطة ناجحة" tone={status.last_success ? "ok" : "warn"}>
              {status.last_success ? (
                <>
                  <p className="text-lg font-semibold tabular-nums">{status.last_success.snapshot_date}</p>
                  <p className="text-xs text-gray-500">{fmtNum(status.last_success.rows)} صفّاً · {fmtNum(status.last_success.duration_ms)}ms · {baghdadTime(status.last_success.finished_at)}</p>
                </>
              ) : <p className="text-sm">لا لقطات بعد.</p>}
            </Card>
            <Card title="آخر فشل" tone={status.last_failure && !status.last_failure.recovered ? "bad" : "ok"}>
              {status.last_failure ? (
                <>
                  <p className="text-sm font-semibold">{status.last_failure.snapshot_date} · مرحلة «{status.last_failure.stage}»</p>
                  <p className="line-clamp-2 text-xs text-gray-600" title={status.last_failure.message}>{status.last_failure.message}</p>
                  <p className="text-xs text-gray-500">{status.last_failure.recovered ? "استُعيد بتشغيل لاحق" : "لم يُستعد بعد"}</p>
                </>
              ) : <p className="text-sm text-gray-600">لا فشل مسجَّل.</p>}
            </Card>
            <Card title="التشغيل القادم" tone={status.enabled ? "ok" : "warn"}>
              <p className="text-lg font-semibold tabular-nums">{status.enabled ? `${baghdadDate(status.next_run_at)} ${baghdadTime(status.next_run_at)}` : "موقوفة"}</p>
              <p className="text-xs text-gray-500">لقطة {status.target_date}: {status.target_done ? "مأخوذة" : "لم تُؤخذ بعد"} · حتى {status.schedule.max_retries} محاولات كل {status.schedule.retry_minutes} دقيقة</p>
              {!status.target_done && <div className="mt-2"><RunSnapshotButton date={status.target_date} /></div>}
            </Card>
            <Card title="التغطية وتطابق الأحداث" tone={status.fact_sync && status.fact_sync.out_of_sync + status.fact_sync.errors > 0 ? "bad" : "ok"}>
              <p className="text-sm">{status.coverage.days} يوماً ({status.coverage.first_date ?? "—"} ← {status.coverage.last_date ?? "—"})</p>
              {status.fact_sync && <p className="text-xs text-gray-600">فرق الأحداث عن أصلها: {status.fact_sync.out_of_sync} · أخطاء كتابة: {status.fact_sync.errors}</p>}
              <p className="text-xs text-gray-500">الاحتفاظ: {status.schedule.retention_days === 0 ? "للأبد" : `${status.schedule.retention_days} يوماً`}</p>
            </Card>
          </section>
        )}

        {reconcile && (
          <section className="rounded-lg border border-gray-200 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
              <h2 className="font-bold text-gray-800">الأحداث مقابل أصلها</h2>
              {admin && <ResyncFacts />}
            </header>
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500"><tr>{["المصدر", "صفوف الأصل", "أحداث", "ناقص", "يتيم"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-100">
                {reconcile.map((r) => (
                  <tr key={r.source}>
                    <td className="px-4 py-2 font-mono text-xs">{r.source}</td>
                    <td className="px-4 py-2 tabular-nums">{fmtNum(r.source_rows)}</td>
                    <td className="px-4 py-2 tabular-nums">{fmtNum(r.fact_rows)}</td>
                    <td className={`px-4 py-2 tabular-nums ${r.missing ? "font-semibold text-red-700" : "text-gray-400"}`}>{r.missing}</td>
                    <td className={`px-4 py-2 tabular-nums ${r.orphaned ? "font-semibold text-red-700" : "text-gray-400"}`}>{r.orphaned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {admin && (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <h2 className="font-bold text-gray-800">إعادة بناء يوم</h2>
              <p className="mb-3 mt-1 text-xs text-gray-500">
                للمدير وحده وبسبب مكتوب. تُكتب لقطة جديدة من التاريخ وتُعتمد، والأصل يبقى كما هو للمقارنة. ما لا تاريخ له (القيمة، الحرارة، الدرجة) يُؤخذ من يوم إعادة البناء — ويُعلَّم.
              </p>
              <RebuildForm defaultDate={addDays(today, -1)} />
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <h2 className="font-bold text-gray-800">استدراك أيام ناقصة</h2>
              <p className="mb-3 mt-1 text-xs text-gray-500">يأخذ لقطة لكل يوم بلا لقطة في المدى، ولا يمسّ المأخوذ. المهمة المجدولة تستدرك آخر ٧ أيام بنفسها.</p>
              <BackfillForm from={addDays(today, -14)} to={addDays(today, -1)} />
            </div>
          </section>
        )}

        {detail && (
          <section className="rounded-lg border border-brand-200 bg-white p-5" id="detail">
            <div className="flex items-baseline justify-between">
              <h2 className="font-bold text-gray-800">تشغيل {String(detail.snapshot_date)} — {TRIGGER[String(detail.trigger_kind)]}</h2>
              <Link href="/dashboard/crm/reports/snapshots" className="text-xs text-gray-500 hover:underline">إغلاق</Link>
            </div>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
              <div><dt className="text-gray-400">كما في</dt><dd>{baghdadDate(String(detail.as_of))} {baghdadTime(String(detail.as_of))} ({String(detail.timezone)})</dd></div>
              <div><dt className="text-gray-400">الطريقة</dt><dd>{detail.method === "daily" ? "يومية" : "مُعاد بناؤها"}</dd></div>
              <div><dt className="text-gray-400">بطلب</dt><dd>{String(detail.requested_by_name ?? "—")}{detail.reason ? ` — ${String(detail.reason)}` : ""}</dd></div>
            </dl>
            {detail.error_message ? (
              <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                <p className="font-semibold">فشل في مرحلة «{String(detail.error_stage)}» ({String(detail.error_sqlstate)})</p>
                <p className="mt-1">{String(detail.error_message)}</p>
                {detail.error_context ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-red-800" dir="ltr">{String(detail.error_context)}</pre> : null}
              </div>
            ) : null}
            {Array.isArray(detail.warnings) && detail.warnings.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-gray-600">التحقّق قبل اللقطة ({detail.warnings.length})</p>
                <ul className="space-y-1">
                  {(detail.warnings as { code: string; severity: string; title: string; affected: number | null; affects_snapshot: boolean; fix: string | null }[]).map((w) => (
                    <li key={w.code} className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-xs ${SEVERITY_STYLE[w.severity] ?? ""}`}>
                      <span className="font-medium">{w.title}</span>
                      {w.affected !== null && <span className="tabular-nums">{fmtNum(w.affected)}</span>}
                      {w.affects_snapshot && <span className="rounded bg-white/70 px-1.5 text-[10px]">يمسّ اللقطة</span>}
                      {w.fix?.startsWith("/") && <Link href={w.fix} className="ms-auto underline">معالجة</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detail.summary ? (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-6">
                {Object.entries(detail.summary as Record<string, number>).map(([k, v]) => (
                  <div key={k} className="rounded border border-gray-100 p-2"><p className="text-gray-500">{nameOf.get(k) ?? k}</p><p className="font-semibold tabular-nums">{fmtNum(v)}</p></div>
                ))}
              </div>
            ) : null}
            {corrections.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-medium text-gray-600">الأصل مقابل المصحَّح (§46) — {corrections[0].corrected_by} · {corrections[0].reason}</p>
                <table className="w-full text-right text-xs">
                  <thead className="text-gray-500"><tr><th className="py-1">المقياس</th><th>الأصل</th><th>المصحَّح</th><th>الفرق</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {corrections.map((c) => (
                      <tr key={c.metric}><td className="py-1">{c.name_ar ?? c.metric}</td><td className="tabular-nums">{fmtNum(c.original)}</td><td className="tabular-nums">{fmtNum(c.corrected)}</td>
                        <td className="tabular-nums" dir="ltr">{c.diff !== null && c.diff > 0 ? "+" : ""}{fmtNum(c.diff)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <section className="rounded-lg border border-gray-200 bg-white">
          <h2 className="border-b px-5 py-3 font-bold text-gray-800">سجلّ التشغيل</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>{["اليوم", "النوع", "الحالة", "بدأ", "المدة", "صفوف", "تحذيرات", "معتمدة", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {runs.map((r) => {
                  const [label, cls] = STATUS[r.status] ?? [r.status, ""];
                  const failedNotRecovered = r.status === "failed" && !runs.some((x) => x.snapshot_date === r.snapshot_date && x.is_current);
                  return (
                    <tr key={r.id} className={r.id === searchParams.run ? "bg-brand-50" : ""}>
                      <td className="px-3 py-2 tabular-nums">{r.snapshot_date}</td>
                      <td className="px-3 py-2 text-xs">{TRIGGER[r.trigger_kind] ?? r.trigger_kind}{r.method === "reconstructed" ? " · مُعاد بناؤها" : ""}{r.attempt > 1 ? ` · #${r.attempt}` : ""}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>{r.error_stage ? <span className="ms-1 text-xs text-red-700">{r.error_stage}</span> : null}</td>
                      <td className="px-3 py-2 text-xs tabular-nums text-gray-600">{baghdadDate(r.started_at)} {baghdadTime(r.started_at)}</td>
                      <td className="px-3 py-2 text-xs tabular-nums">{r.duration_ms !== null ? `${fmtNum(r.duration_ms)}ms` : "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtNum(r.records_created)}</td>
                      <td className="px-3 py-2 tabular-nums">{r.warning_count || "—"}</td>
                      <td className="px-3 py-2">{r.is_current ? "✓" : r.superseded_by ? <span className="text-xs text-gray-400">استُبدلت</span> : ""}</td>
                      <td className="px-3 py-2 text-xs">
                        <Link href={`/dashboard/crm/reports/snapshots?run=${r.id}#detail`} className="text-brand-700 hover:underline">التفاصيل</Link>
                        {failedNotRecovered && <span className="ms-2"><RunSnapshotButton date={r.snapshot_date} label="أعد المحاولة" retry /></span>}
                      </td>
                    </tr>
                  );
                })}
                {runs.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">لا تشغيل بعد.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Card({ title, tone, children }: { title: string; tone: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  const border = tone === "bad" ? "border-red-300" : tone === "warn" ? "border-amber-300" : "border-gray-200";
  return (
    <div className={`rounded-lg border bg-white p-4 ${border}`}>
      <p className="mb-1 text-xs text-gray-500">{title}</p>
      {children}
    </div>
  );
}
