import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { canSeeTeam, isAdmin } from "@/lib/auth";
import {
  Reservation,
  RESERVATION_STATUS_COLORS,
  formatPrice,
  salePending,
} from "@/lib/types";
import DeleteReservationButton from "./delete-reservation-button";
import SaleRequest from "@/components/sale-request";
import CrmTabs from "../crm/crm-tabs";

// صفحة قائمة الحجوزات — تعرض اسم العميل والوحدة عبر الربط بين الجداول
export default async function ReservationsPage() {
  const supabase = await createClient();

  // نجلب الحجوزات مع بيانات العميل والوحدة المرتبطة
  const { data, error } = await supabase
    .from("reservations")
    .select("*, clients(name), units(project, unit_code)")
    .order("created_at", { ascending: false });

  const reservations = (data ?? []) as Reservation[];
  const admin = await isAdmin();
  // ما يراه المشرف من حجوزات هو نطاقه أصلاً (سياسة القاعدة تفلترها)
  const canEdit = await canSeeTeam();

  // طلبات البيع المعلّقة — تُعرض لمن يملك البتّ فيها وحده.
  // (القاعدة ترفض قرار غيره على أي حال، لكن عرضَ زرٍّ لا يعمل عبث.)
  const pending = canEdit ? reservations.filter(salePending) : [];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">CRM</h1>
        </div>
        <Link
          href="/dashboard/reservations/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + حجز جديد
        </Link>
      </header>

      <CrmTabs active="reservations" />

      <section className="p-6">
        {/* ===== ما ينتظر توقيع الإدارة =====
            الطلبات فوق الجدول لا داخله: الجدول سجلّ يُقرأ، وهذه
            أعمالٌ معلّقة — من فتح الشاشة لأجلها وجدها أولاً.
            (إليها يقود إشعار «طلب تحويل حجز إلى بيع» — sql/050) */}
        {pending.length > 0 && (
          <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-blue-900">
              <span className="material-symbols-outlined text-[18px]">
                pending_actions
              </span>
              طلبات تحويل حجز إلى بيع بانتظار قرارك ({pending.length})
            </h2>

            <div className="space-y-3">
              {pending.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-blue-200 bg-white p-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/units/${r.unit_id}`}
                      className="font-bold text-gray-800 hover:text-brand-700 hover:underline"
                    >
                      {r.units
                        ? `${r.units.project}${
                            r.units.unit_code ? " - " + r.units.unit_code : ""
                          }`
                        : "وحدة"}
                    </Link>
                    <p className="truncate text-xs text-gray-500">
                      {r.clients?.name ?? "—"}
                      {r.created_by_name && (
                        <span className="ms-2 text-gray-400">
                          طلبه: {r.created_by_name}
                        </span>
                      )}
                      {r.amount !== null && (
                        <span dir="ltr" className="ms-2 text-gray-400">
                          {formatPrice(r.amount)} د.ع
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="ms-auto">
                    <SaleRequest
                      reservationId={r.id}
                      status={r.status}
                      requestStatus={r.sale_request_status}
                      requestNote={r.sale_request_note}
                      rejectReason={r.sale_reject_reason}
                      canDecide={canEdit}
                      canRequest={false}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            تعذّر جلب الحجوزات: {error.message}
            <br />
            تأكّد من تشغيل ملف SQL لإنشاء جدول الحجوزات.
          </div>
        )}

        {!error && reservations.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا توجد حجوزات بعد — أضف أول حجز.
          </div>
        )}

        {!error && reservations.length > 0 && (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[800px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">العميل</th>
                  <th className="px-4 py-3 font-medium">الوحدة</th>
                  <th className="px-4 py-3 font-medium">تاريخ الحجز</th>
                  <th className="px-4 py-3 font-medium">المبلغ</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/dashboard/reservations/${r.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {r.clients?.name ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {r.units
                        ? `${r.units.project}${
                            r.units.unit_code ? " - " + r.units.unit_code : ""
                          }`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">
                      {r.reservation_date || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-800" dir="ltr">
                      {formatPrice(r.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          RESERVATION_STATUS_COLORS[r.status] ??
                          "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {r.status}
                      </span>
                      {/* الموظف يتابع طلبه من هنا بلا فتح كل وحدة */}
                      {salePending(r) && (
                        <span className="ms-1.5 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                          طلب بيع معلّق
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        href={`/dashboard/reservations/${r.id}`}
                        className="me-3 text-sm text-brand-700 hover:underline"
                      >
                        عرض
                      </Link>
                      {canEdit && (
                        <Link
                          href={`/dashboard/reservations/${r.id}/edit`}
                          className="me-3 text-sm text-brand-700 hover:underline"
                        >
                          تعديل
                        </Link>
                      )}
                      {/* الحذف للمدير وحده */}
                      {admin && <DeleteReservationButton id={r.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && reservations.length > 0 && (
          <p className="mt-3 text-sm text-gray-500">
            الإجمالي: {reservations.length} حجز
          </p>
        )}
      </section>
    </main>
  );
}
