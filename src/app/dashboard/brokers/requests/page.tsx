import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeBrokers } from "@/lib/auth";
import { getTeamMembers } from "@/lib/projects";
import { getBrokerRequests } from "@/lib/brokers";
import {
  BROKER_REQUEST_COLORS,
  RESERVATION_STATUS_COLORS,
  formatPrice,
  isOpenBrokerRequest,
} from "@/lib/types";
import BrokersTabs from "../brokers-tabs";
import RequestActions from "./request-actions";

// ============================================================
// طلبات الحجز من الوسطاء — لمدير العلاقات والإدارة (sql/117).
//
// المفتوح أولاً، والأقدم منه أولاً: الوحدة مقفولة على طلبٍ مفتوح فلا
// يطلبها وسيطٌ آخر، فكل ساعة تأخير تحجب الوحدة عن السوق.
// ============================================================
export default async function BrokerRequestsPage() {
  if (!(await canSeeBrokers())) redirect("/dashboard");

  const [requests, members] = await Promise.all([getBrokerRequests(), getTeamMembers()]);

  const open = requests
    .filter((r) => isOpenBrokerRequest(r.status))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const closed = requests.filter((r) => !isOpenBrokerRequest(r.status));

  const rmName = (id: string | null) => members.find((m) => m.id === id)?.full_name ?? null;
  const age = (iso: string) => {
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 36e5);
    return h < 24 ? `منذ ${h} ساعة` : `منذ ${Math.floor(h / 24)} يوم`;
  };

  const card = (r: (typeof requests)[number]) => (
    <div key={r.id} className="glass-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-gray-800">
            الوحدة {r.unit_code ?? "—"}
            <span className="ms-2 text-sm font-normal text-gray-500">
              {r.projects?.name ?? ""}
            </span>
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            <Link
              href={`/dashboard/brokers/${r.company_id}`}
              className="font-semibold text-brand-700 hover:underline"
            >
              {r.broker_companies?.name ?? "شركة"}
            </Link>
            {" · العميل "}
            <Link href={`/dashboard/clients/${r.client_id}`} className="hover:underline">
              {r.clients?.name ?? "—"}
            </Link>
            {r.clients?.phone && (
              <span className="ms-1 text-xs text-gray-500" dir="ltr">
                {r.clients.phone}
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {r.requested_by_name ?? "الوسيط"} · {age(r.created_at)}
            {r.unit_price ? (
              <>
                {" · السعر يوم الطلب "}
                <span dir="ltr">{formatPrice(Number(r.unit_price))}</span>
              </>
            ) : null}
            {" · يتابع: "}
            {rmName(r.rm_id) ?? "بلا مدير علاقات — الإدارة"}
          </p>
          {r.note && <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{r.note}</p>}
          {r.decision_note && !isOpenBrokerRequest(r.status) && (
            <p className="mt-2 text-xs text-gray-500">
              {r.handled_by_name ?? ""}: {r.decision_note}
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
              الحجز: {r.reservation_status}
            </span>
          )}
        </div>
      </div>
      <div className="mt-3">
        <RequestActions request={r} />
      </div>
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">طلبات الحجز من الوسطاء</h1>
      </header>

      <BrokersTabs active="requests" />

      <section className="space-y-6 p-6">
        <div>
          <h2 className="mb-3 text-lg font-bold text-gray-800">
            مفتوحة ({open.length})
          </h2>
          {open.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
              لا طلبات تنتظر.
            </p>
          ) : (
            <div className="space-y-3">{open.map(card)}</div>
          )}
        </div>

        {closed.length > 0 && (
          <div>
            <h2 className="mb-3 text-lg font-bold text-gray-800">السابقة</h2>
            <div className="space-y-3">{closed.slice(0, 50).map(card)}</div>
          </div>
        )}
      </section>
    </main>
  );
}
