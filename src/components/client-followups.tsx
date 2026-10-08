import Link from "next/link";
import { Client, toIntlPhone } from "@/lib/types";
import { getMyFollowUps, FollowUpRow } from "@/lib/client-followups";
import { getI18n } from "@/lib/i18n/server";
import { tValue } from "@/lib/i18n/values";
import { fill, fmtNumber } from "@/lib/dashboard/format";

// ============================================================
// «متابعات العملاء» — العملاء الذين حان أو فات موعد متابعتهم.
//
// يعمل للمدير وللموظف بنفس الشيفرة: حماية الصفوف في القاعدة تُرجع
// لكل واحد عملاءه فقط، فالموظف يرى متابعاته والمدير يرى الجميع.
//
// نمطان:
//   compact → بطاقة مختصرة للوحة التحكم (تختفي إن لا يوجد شيء)
//   الكامل  → عمودان (متأخرة / اليوم) في صفحة المهام
// ============================================================

// صف واحد: الاسم والحالة وأزرار الاتصال المباشر
function FollowUpRowView({
  c,
  daysLate,
  stalled,
  projectName,
}: {
  c: Client;
  daysLate: number;
  stalled?: boolean;
  projectName?: string;
}) {
  const intl = c.phone ? toIntlPhone(c.phone) : "";
  const { locale, t } = getI18n();
  const w = t.dash.work;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0 hover:bg-gray-50">
      <div className="min-w-0 flex-1">
        <Link
          href={`/dashboard/clients/${c.id}`}
          className="font-medium text-gray-800 hover:text-brand-700"
        >
          {c.name}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
          <span>{tValue(c.stage ?? "ليد", locale)}</span>
          {projectName && (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
              {projectName}
            </span>
          )}
          {c.sales_employee && <span>{c.sales_employee}</span>}
          {c.phone && (
            <span dir="ltr" className="text-gray-400">
              {c.phone}
            </span>
          )}
          {stalled && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
              {w.stalled}
            </span>
          )}
        </div>
      </div>

      <span
        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
          daysLate === 0
            ? "bg-blue-50 text-blue-700"
            : daysLate <= 3
            ? "bg-amber-50 text-amber-700"
            : "bg-red-50 text-red-700"
        }`}
      >
        {daysLate === 0 ? w.dueToday : fill(w.lateDays, { n: fmtNumber(daysLate, locale) })}
      </span>

      {c.phone && (
        <div className="flex gap-1.5">
          <a
            href={`tel:${intl}`}
            title={w.call}
            aria-label={`${w.call} — ${c.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-700"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">call</span>
          </a>
          <a
            href={`https://wa.me/${intl.replace("+", "")}`}
            target="_blank"
            rel="noopener noreferrer"
            title={w.whatsapp}
            aria-label={`${w.whatsapp} — ${c.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 text-white transition hover:bg-green-700"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">chat</span>
          </a>
        </div>
      )}
    </div>
  );
}

// قيمة فرز «بلا مشروع» في الرابط (?proj=none)
const NO_PROJECT = "none";

export default async function ClientFollowUps({
  compact = false,
  limit = 50,
  project = "",
  params = {},
}: {
  compact?: boolean;
  limit?: number;
  project?: string;                // فرز المشروع (النمط الكامل): "" = الكل
  params?: Record<string, string>; // بقية فلاتر الصفحة تُحفظ في روابط الفرز
}) {
  const all = await getMyFollowUps();
  const { total, projects, noProject, ready } = all;

  // تعذّرت القراءة (جدول/عمود غير جاهز) — لا نكسر الصفحة
  if (!ready) return null;

  // الفرز بالمشروع للنمط الكامل فقط؛ البطاقة المختصرة تعرض الكل دائماً
  const projectFilter = compact ? "" : project;
  const keep = (r: FollowUpRow) =>
    !projectFilter ||
    (projectFilter === NO_PROJECT
      ? !r.projectId || !projects.some((p) => p.id === r.projectId)
      : r.projectId === projectFilter);
  const overdue = all.overdue.filter(keep);
  const dueToday = all.dueToday.filter(keep);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  // ===== النمط المختصر: بطاقة في لوحة التحكم =====
  if (compact) {
    if (total === 0) return null; // لا نزحم اللوحة بلا داعٍ

    const rows = [...overdue, ...dueToday].slice(0, 5);
    const { locale, t } = getI18n();
    const w = t.dash.work;

    return (
      <section aria-labelledby="followups-title" className="dash-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <h2 id="followups-title" className="flex items-center gap-2 text-sm font-bold text-ink">
            <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-warning-600">event_repeat</span>
            {w.followupsTitle}
            <span className="rounded-full bg-warning-600 px-2 py-0.5 text-xs font-bold text-white">
              {fmtNumber(total, locale)}
            </span>
          </h2>
          <Link href="/dashboard/tasks" className="dash-focus rounded text-xs font-bold text-brand-700 hover:underline">
            {t.dash.common.viewAll}
          </Link>
        </div>

        {overdue.length > 0 && (
          <p className="mx-4 mb-3 rounded-lg bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700 sm:mx-5">
            {fill(w.followupsLate, { n: fmtNumber(overdue.length, locale) })}
          </p>
        )}

        <div className="border-t border-line">
          {rows.map((r) => (
            <FollowUpRowView
              key={r.client.id}
              c={r.client}
              daysLate={r.daysLate}
              stalled={r.stalled}
            />
          ))}
        </div>

        {total > rows.length && (
          <Link
            href="/dashboard/tasks"
            className="dash-focus block border-t border-line py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-surface-subtle"
          >
            {fill(w.moreFollowups, { n: fmtNumber(total - rows.length, locale) })}
          </Link>
        )}
      </section>
    );
  }

  // ===== النمط الكامل: عمودان في صفحة المهام =====

  // أزرار الفرز: «الكل» ثم كل مشروع له متابعات ثم «بلا مشروع».
  // تظهر فقط حين يكون هناك ما يُفرز (أكثر من مجموعة واحدة)
  const chips = [
    { value: "", label: "كل المشاريع", count: total },
    ...projects.map((p) => ({ value: p.id, label: p.name, count: p.count })),
    ...(noProject > 0 ? [{ value: NO_PROJECT, label: "بلا مشروع", count: noProject }] : []),
  ];
  const showChips = chips.length > 2;
  const chipHref = (value: string) => {
    const q = new URLSearchParams(params);
    if (value) q.set("proj", value);
    else q.delete("proj");
    const s = q.toString();
    return s ? `/dashboard/tasks?${s}` : "/dashboard/tasks";
  };
  const shown = overdue.length + dueToday.length;
  // اسم المشروع على الصف حين نعرض الكل — لا داعي له بعد الفرز
  const badge = (r: FollowUpRow) =>
    showChips && !projectFilter && r.projectId ? projectName.get(r.projectId) : undefined;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-amber-800">
        <span className="material-symbols-outlined">groups</span>
        متابعات العملاء ({shown === total ? total : `${shown} من ${total}`})
      </h2>
      <p className="mb-3 text-sm text-gray-500">
        عملاء حان أو فات موعد متابعتهم. سجّل المكالمة من صفحة العميل ليتحدّث
        الموعد تلقائياً.
      </p>

      {showChips && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-gray-400">apartment</span>
          {chips.map((ch) => {
            const active = ch.value === projectFilter;
            return (
              <Link
                key={ch.value || "all"}
                href={chipHref(ch.value)}
                scroll={false}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:border-brand-300 hover:bg-brand-50"
                }`}
              >
                {ch.label}{" "}
                <span className={active ? "text-white/80" : "text-gray-400"} dir="ltr">
                  ({ch.count})
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* المتأخرة */}
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b bg-red-50 px-4 py-3">
            <h3 className="font-bold text-red-800">
              🔴 متابعات متأخرة ({overdue.length})
            </h3>
            <span className="text-xs text-red-700">اتصل بهم أولاً</span>
          </div>
          {overdue.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">
              ما في متابعة متأخرة — ممتاز.
            </p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {overdue.slice(0, limit).map((r) => (
                <FollowUpRowView
                  key={r.client.id}
                  c={r.client}
                  daysLate={r.daysLate}
                  stalled={r.stalled}
                  projectName={badge(r)}
                />
              ))}
            </div>
          )}
        </div>

        {/* موعدها اليوم */}
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b bg-blue-50 px-4 py-3">
            <h3 className="font-bold text-blue-800">
              📅 متابعات اليوم ({dueToday.length})
            </h3>
          </div>
          {dueToday.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">
              لا توجد متابعات مجدولة اليوم.
            </p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {dueToday.slice(0, limit).map((r) => (
                <FollowUpRowView
                  key={r.client.id}
                  c={r.client}
                  daysLate={0}
                  projectName={badge(r)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
