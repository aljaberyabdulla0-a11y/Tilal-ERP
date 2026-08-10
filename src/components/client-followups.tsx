import Link from "next/link";
import { Client, toIntlPhone } from "@/lib/types";
import { getMyFollowUps } from "@/lib/client-followups";

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
}: {
  c: Client;
  daysLate: number;
  stalled?: boolean;
}) {
  const intl = c.phone ? toIntlPhone(c.phone) : "";

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
          <span>{c.stage ?? "ليد"}</span>
          {c.sales_employee && <span>{c.sales_employee}</span>}
          {c.phone && (
            <span dir="ltr" className="text-gray-400">
              {c.phone}
            </span>
          )}
          {stalled && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
              بلا تحديث
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
        {daysLate === 0 ? "موعده اليوم" : `متأخر ${daysLate} يوم`}
      </span>

      {c.phone && (
        <div className="flex gap-1.5">
          <a
            href={`tel:${intl}`}
            title="اتصال"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-700"
          >
            <span className="material-symbols-outlined text-[18px]">call</span>
          </a>
          <a
            href={`https://wa.me/${intl.replace("+", "")}`}
            target="_blank"
            rel="noopener noreferrer"
            title="واتساب"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 text-white transition hover:bg-green-700"
          >
            <span className="material-symbols-outlined text-[18px]">chat</span>
          </a>
        </div>
      )}
    </div>
  );
}

export default async function ClientFollowUps({
  compact = false,
  limit = 50,
}: {
  compact?: boolean;
  limit?: number;
}) {
  const { overdue, dueToday, total, ready } = await getMyFollowUps();

  // تعذّرت القراءة (جدول/عمود غير جاهز) — لا نكسر الصفحة
  if (!ready) return null;

  // ===== النمط المختصر: بطاقة في لوحة التحكم =====
  if (compact) {
    if (total === 0) return null; // لا نزحم اللوحة بلا داعٍ

    const rows = [...overdue, ...dueToday].slice(0, 5);

    return (
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <h4 className="flex items-center gap-2 text-lg font-bold text-brand-900">
            <span className="material-symbols-outlined text-amber-600">event_repeat</span>
            متابعات عملائي
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
              {total}
            </span>
          </h4>
          <Link
            href="/dashboard/tasks"
            className="text-sm font-bold text-brand-700 hover:underline"
          >
            عرض الكل
          </Link>
        </div>

        {overdue.length > 0 && (
          <p className="mx-5 mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {overdue.length} متابعة متأخرة — اتصل بهم أولاً.
          </p>
        )}

        <div className="border-t border-gray-100">
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
            className="block border-t border-gray-100 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-gray-50"
          >
            وعندك {total - rows.length} متابعة أخرى…
          </Link>
        )}
      </div>
    );
  }

  // ===== النمط الكامل: عمودان في صفحة المهام =====
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-amber-800">
        <span className="material-symbols-outlined">groups</span>
        متابعات العملاء ({total})
      </h2>
      <p className="mb-3 text-sm text-gray-500">
        عملاء حان أو فات موعد متابعتهم. سجّل المكالمة من صفحة العميل ليتحدّث
        الموعد تلقائياً.
      </p>

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
                <FollowUpRowView key={r.client.id} c={r.client} daysLate={0} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
