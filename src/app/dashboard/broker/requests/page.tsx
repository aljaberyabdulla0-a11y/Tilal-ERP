import Link from "next/link";
import { redirect } from "next/navigation";
import { isBroker } from "@/lib/auth";
import { getBrokerRequests } from "@/lib/brokers";
import {
  BROKER_REQUEST_COLORS,
  RESERVATION_STATUS_COLORS,
  formatPrice,
  isOpenBrokerRequest,
} from "@/lib/types";
import CancelRequest from "./cancel-request";

// ============================================================
// «طلباتنا» — طلبات الحجز التي رفعتها الشركة ومسار كلٍّ منها:
// معلّق ← قيد المتابعة ← تمّ الحجز ← (بيع مكتمل) — أو مرفوض بسببه.
// حالة الحجز بعد إنشائه مرآةٌ في الطلب نفسه، فالوسيط لا يقرأ
// جدول الحجوزات (sql/117).
// ============================================================
export default async function BrokerRequestsPage() {
  if (!(await isBroker())) redirect("/dashboard");

  const requests = await getBrokerRequests();
  const open = requests.filter((r) => isOpenBrokerRequest(r.status));
  const closed = requests.filter((r) => !isOpenBrokerRequest(r.status));

  const row = (r: (typeof requests)[number]) => (
    <div key={r.id} className="glass-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-gray-800">
            الوحدة {r.unit_code ?? "—"}
            <span className="ms-2 text-sm font-normal text-gray-500">{r.projects?.name ?? ""}</span>
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            العميل{" "}
            <Link href={`/dashboard/broker/leads/${r.client_id}`} className="font-semibold hover:underline">
              {r.clients?.name ?? "—"}
            </Link>
            {r.unit_price ? (
              <span className="ms-2 text-gray-500" dir="ltr">
                {formatPrice(Number(r.unit_price))}
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {r.requested_by_name ?? ""} · <span dir="ltr">{r.created_at.slice(0, 10)}</span>
            {r.handled_by_name && ` · يتابعها ${r.handled_by_name}`}
          </p>
          {r.note && <p className="mt-2 text-sm text-gray-600">{r.note}</p>}
          {r.decision_note && (
            <p
              className={`mt-2 rounded-lg px-3 py-2 text-sm ${
                r.status === "مرفوض" ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-700"
              }`}
            >
              {r.decision_note}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${BROKER_REQUEST_COLORS[r.status]}`}>
            {r.status}
          </span>
          {r.reservation_status && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                RESERVATION_STATUS_COLORS[r.reservation_status] ?? "bg-gray-100 text-gray-600"
              }`}
            >
              {r.reservation_status === "بيع مكتمل" ? "بيع مكتمل 🎉" : `الحجز: ${r.reservation_status}`}
            </span>
          )}
          {isOpenBrokerRequest(r.status) && <CancelRequest id={r.id} />}
        </div>
      </div>
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحتنا
          </Link>
          <h1 className="text-xl font-bold text-brand-700">طلبات الحجز</h1>
        </div>
        <Link
          href="/dashboard/broker/units"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + طلب جديد من الوحدات
        </Link>
      </header>

      <section className="space-y-6 p-6">
        <div>
          <h2 className="mb-3 text-lg font-bold text-gray-800">قيد المتابعة ({open.length})</h2>
          {open.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
              لا طلبات مفتوحة.
            </p>
          ) : (
            <div className="space-y-3">{open.map(row)}</div>
          )}
        </div>
        {closed.length > 0 && (
          <div>
            <h2 className="mb-3 text-lg font-bold text-gray-800">السابقة</h2>
            <div className="space-y-3">{closed.map(row)}</div>
          </div>
        )}
      </section>
    </main>
  );
}
