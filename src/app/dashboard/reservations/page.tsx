import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import {
  Reservation,
  RESERVATION_STATUS_COLORS,
  formatPrice,
} from "@/lib/types";
import DeleteReservationButton from "./delete-reservation-button";
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
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        href={`/dashboard/reservations/${r.id}`}
                        className="me-3 text-sm text-brand-700 hover:underline"
                      >
                        عرض
                      </Link>
                      {admin && (
                        <>
                          <Link
                            href={`/dashboard/reservations/${r.id}/edit`}
                            className="me-3 text-sm text-brand-700 hover:underline"
                          >
                            تعديل
                          </Link>
                          <DeleteReservationButton id={r.id} />
                        </>
                      )}
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
