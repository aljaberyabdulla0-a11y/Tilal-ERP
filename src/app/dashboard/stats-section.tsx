import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/types";

// قسم الإحصائيات في لوحة التحكم — أرقام سريعة عن حالة النظام
// يتحمّل غياب أي جدول (يعرض صفراً بدل الانهيار)
export default async function StatsSection() {
  const supabase = await createClient();

  const [clientsRes, unitsRes, reservationsRes] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("units").select("status"),
    supabase.from("reservations").select("status, amount"),
  ]);

  const clientsCount = clientsRes.count ?? 0;

  const units = (unitsRes.data ?? []) as { status: string }[];
  const unitsTotal = units.length;
  const unitsAvailable = units.filter((u) => u.status === "متاحة").length;
  const unitsReserved = units.filter((u) => u.status === "محجوزة").length;
  const unitsSold = units.filter((u) => u.status === "مباعة").length;

  const reservations = (reservationsRes.data ?? []) as {
    status: string;
    amount: number | null;
  }[];
  const reservationsTotal = reservations.length;
  const reservationsDone = reservations.filter(
    (r) => r.status === "بيع مكتمل"
  ).length;
  const totalAmount = reservations.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* العملاء */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">إجمالي العملاء</span>
          <span className="text-2xl">👥</span>
        </div>
        <p className="mt-2 text-3xl font-bold text-gray-800">{clientsCount}</p>
      </div>

      {/* الوحدات */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">الوحدات العقارية</span>
          <span className="text-2xl">🏢</span>
        </div>
        <p className="mt-2 text-3xl font-bold text-gray-800">{unitsTotal}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
            متاحة {unitsAvailable}
          </span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
            محجوزة {unitsReserved}
          </span>
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
            مباعة {unitsSold}
          </span>
        </div>
      </div>

      {/* الحجوزات */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">الحجوزات</span>
          <span className="text-2xl">📝</span>
        </div>
        <p className="mt-2 text-3xl font-bold text-gray-800">{reservationsTotal}</p>
        <p className="mt-2 text-xs text-gray-500">
          منها <b className="text-green-700">{reservationsDone}</b> بيع مكتمل
        </p>
      </div>

      {/* المبالغ المحصّلة */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">المبالغ المحصّلة</span>
          <span className="text-2xl">💰</span>
        </div>
        <p className="mt-2 text-2xl font-bold text-gray-800" dir="ltr">
          {formatPrice(totalAmount)}
        </p>
        <p className="mt-1 text-xs text-gray-400">دينار عراقي</p>
      </div>
    </div>
  );
}
