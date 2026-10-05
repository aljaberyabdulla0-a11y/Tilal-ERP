import { BROKER_REQUEST_COLORS, BrokerRequestEvent } from "@/lib/types";

// ============================================================
// الخطّ الزمني لطلب الحجز (sql/128) — من فعل ماذا، بأي صفة، ومتى، ومن أي
// حالة إلى أي حالة. الأحداث الداخلية (التوصية، الإشعارات) لا تصل الوسيط
// أصلاً: القاعدة تحذفها من broker_request_detail له.
// ============================================================
export default function BrokerRequestTimeline({ events }: { events: BrokerRequestEvent[] }) {
  if (!events.length) return <p className="text-sm text-gray-400">لا أحداث بعد.</p>;

  return (
    <ol className="relative space-y-4 border-s-2 border-gray-200 ps-5">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span
            className={`absolute -start-[27px] top-1 h-3 w-3 rounded-full border-2 border-white ${
              e.action === "إشعار" ? "bg-gray-300" : e.new_status ? "bg-brand-600" : "bg-amber-400"
            }`}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-xs text-gray-400" dir="ltr">
              {new Date(e.at).toLocaleString("en-GB", {
                timeZone: "Asia/Baghdad",
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <b className="text-gray-800">{e.action}</b>
            {e.new_status && (
              <span className="text-xs text-gray-500">
                {e.old_status ? `${e.old_status} ← ` : ""}
                <span className={`rounded-full px-2 py-0.5 font-semibold ${BROKER_REQUEST_COLORS[e.new_status] ?? "bg-gray-100"}`}>
                  {e.new_status}
                </span>
              </span>
            )}
            {e.internal && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">داخلي</span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            {e.actor_name ?? "النظام"}
            {e.actor_role ? ` · ${e.actor_role}` : ""}
          </p>
          {e.note && <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}
