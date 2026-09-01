import Link from "next/link";
import SaleRequest from "@/components/sale-request";
import {
  Reservation,
  formatPrice,
  ownsReservation,
  reservationExpired,
} from "@/lib/types";

// ============================================================
// صفقات المشروع القائمة — الشريط الذي يُتّخذ فيه القرار.
//
// للإدارة: الطلبات المعلّقة وحدها. لا نعرض لها كل حجوزات المشروع
// هنا — لها شاشة الحجوزات كاملة؛ المطلوب في هذه الشاشة ما ينتظر
// توقيعها.
//
// للموظف: حجوزاته هو في هذا المشروع. كان عليه أن يفتح كل وحدة
// ليعرف أين وصلت صفقته، وصارت أمامه في سطر واحد مع زرّ الطلب.
// ============================================================
export default function ProjectDeals({
  deals,
  canManage,
  userId,
  employeeId,
}: {
  deals: Reservation[];
  canManage: boolean;
  userId: string | null;
  employeeId: string | null;
}) {
  if (deals.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-1.5 border-b border-gray-100 pb-2 text-sm font-bold text-gray-700">
        <span className="material-symbols-outlined text-[18px] text-brand-600">
          {canManage ? "pending_actions" : "handshake"}
        </span>
        {canManage
          ? `طلبات بيع بانتظار قرارك (${deals.length})`
          : `حجوزاتي في هذا المشروع (${deals.length})`}
      </h3>

      <div className="space-y-3">
        {deals.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200 p-3"
          >
            <div className="min-w-0">
              <Link
                href={`/dashboard/units/${r.unit_id}`}
                className="font-bold text-gray-800 hover:text-brand-700 hover:underline"
              >
                {r.units?.unit_code || "وحدة"}
              </Link>
              <p className="truncate text-xs text-gray-500">
                {r.clients?.name ?? "—"}
                {r.amount !== null && (
                  <span dir="ltr" className="ms-2 text-gray-400">
                    {formatPrice(r.amount)} د.ع
                  </span>
                )}
              </p>
            </div>

            {/* مهلة انتهت: قرارٌ متأخّر لا معلومة عابرة */}
            {reservationExpired(r) && (
              <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-medium text-red-700">
                انتهت المهلة
              </span>
            )}

            {canManage && r.created_by_name && (
              <span className="text-xs text-gray-400">
                طلبه: {r.created_by_name}
              </span>
            )}

            <div className="ms-auto flex flex-wrap items-center gap-2">
              <SaleRequest
                reservationId={r.id}
                status={r.status}
                requestStatus={r.sale_request_status}
                requestNote={r.sale_request_note}
                rejectReason={r.sale_reject_reason}
                canDecide={canManage}
                canRequest={canManage || ownsReservation(r, userId, employeeId)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
