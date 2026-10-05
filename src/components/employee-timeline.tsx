import type { TimelineEvent } from "@/lib/types";

// الخط الزمني للموظف — من employee_timeline() (sql/148). الدالة تقرأ
// من الجداول القائمة وسجلّ التدقيق، فلا يتباعد السجلّ عن الواقع.
const KIND_STYLE: Record<string, string> = {
  تعيين: "bg-green-500",
  راتب: "bg-emerald-500",
  تنظيم: "bg-blue-500",
  إجازة: "bg-sky-400",
  عمولة: "bg-teal-500",
  استقطاع: "bg-red-400",
  مستند: "bg-gray-400",
  خدمة: "bg-purple-500",
};

export default function EmployeeTimeline({ events, error }: { events: TimelineEvent[]; error?: string | null }) {
  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <h3 className="mb-3 text-lg font-semibold text-gray-800">الخط الزمني</h3>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-gray-400">لا أحداث بعد.</p>
      ) : (
        <ol className="relative space-y-4 border-s border-gray-200 ps-5">
          {events.map((e, i) => (
            <li key={i} className="relative">
              <span className={`absolute -start-[1.65rem] top-1.5 h-2.5 w-2.5 rounded-full ${KIND_STYLE[e.kind] ?? "bg-gray-300"}`} />
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-gray-800">{e.title}</span>
                <span className="text-[11px] text-gray-400" dir="ltr">{e.occurred_at.slice(0, 10)}</span>
              </div>
              {e.details && <p className="text-xs text-gray-600">{e.details}</p>}
              {e.actor && <p className="text-[11px] text-gray-400">بواسطة {e.actor}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
