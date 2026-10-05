import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isBroker } from "@/lib/auth";
import { getBrokerRequestDetail } from "@/lib/brokers";
import { BROKER_REQUEST_COLORS, formatPrice, isOpenBrokerRequest } from "@/lib/types";
import BrokerRequestTimeline from "@/components/broker-request-timeline";
import AnswerInfo from "../answer-info";
import CancelRequest from "../cancel-request";

// ============================================================
// طلبٌ واحد كما يراه الوسيط: الوحدة والسعر، من يتابعه، وما حدث له.
// broker_request_detail يحذف الداخلي (التوصية، تاريخ العميل في تلال،
// الإشعارات) قبل أن يصل — لا شيء هنا يُخفى بالواجهة وحدها.
// ============================================================
export default async function BrokerRequestDetailPage({ params }: { params: { id: string } }) {
  if (!(await isBroker())) redirect("/dashboard");
  const d = await getBrokerRequestDetail(params.id);
  if (!d) notFound();

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/broker/requests" className="text-sm text-gray-500 hover:text-brand-700">
            ← طلباتنا
          </Link>
          <h1 className="text-xl font-bold text-brand-700">
            الوحدة {d.unit_code ?? "—"} · {d.project_name ?? ""}
          </h1>
        </div>
        <span className={`rounded-full px-4 py-1.5 text-sm font-bold ${BROKER_REQUEST_COLORS[d.status]}`}>{d.status}</span>
      </header>

      <section className="grid grid-cols-1 gap-5 p-6 lg:grid-cols-3">
        <div className="glass-card space-y-2 p-5 text-sm text-gray-700">
          <p>العميل: <b>{d.client_name ?? "—"}</b></p>
          <p>سعر الوحدة: <span dir="ltr">{formatPrice(Number(d.unit_price ?? 0))}</span></p>
          {d.requested_price && <p>السعر المطلوب: <span dir="ltr">{formatPrice(Number(d.requested_price))}</span></p>}
          {d.payment_plan && <p>خطة الدفع: {d.payment_plan}</p>}
          <p>يتابعه: {d.rm_name ?? "—"}</p>
          {d.expires_at && isOpenBrokerRequest(d.status) && (
            <p className="text-xs text-gray-500">
              ينتهي بلا قرار: {new Date(d.expires_at).toLocaleString("ar", { timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short" })}
            </p>
          )}
          {d.decision_note && !isOpenBrokerRequest(d.status) && (
            <p className={`rounded-lg px-3 py-2 ${d.status === "مرفوض" ? "bg-red-50 text-red-700" : "bg-gray-50"}`}>{d.decision_note}</p>
          )}
          {d.status === "بحاجة لمعلومات" && <AnswerInfo id={d.id} question={d.info_request} />}
          {isOpenBrokerRequest(d.status) && <CancelRequest id={d.id} />}
        </div>
        <div className="glass-card p-5 lg:col-span-2">
          <h2 className="mb-4 text-lg font-bold text-gray-800">ما حدث للطلب</h2>
          <BrokerRequestTimeline events={d.events} />
        </div>
      </section>
    </main>
  );
}
