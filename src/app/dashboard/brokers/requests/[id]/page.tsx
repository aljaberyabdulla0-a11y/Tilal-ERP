import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canSeeBrokers } from "@/lib/auth";
import { getBrokerRequestDetail } from "@/lib/brokers";
import {
  BROKER_REQUEST_COLORS,
  RESERVATION_STATUS_COLORS,
  formatPrice,
  isOpenBrokerRequest,
} from "@/lib/types";
import BrokerRequestTimeline from "@/components/broker-request-timeline";
import RequestActions from "./request-actions";

// ============================================================
// طلب حجزٍ واحد — كل ما يحتاجه القرار في صفحة (sql/130 broker_request_detail):
// العميل وتاريخه عندنا، الشركة ومن رفع، الـRM وتوصيته، المشروع والمشرف،
// الوحدة وسعرها والسعر المطلوب والخصم وخطة الدفع، الطلبات الأخرى، والخطّ
// الزمني. والأزرار بحسب صفة الناظر — القاعدة تقرّر can_* لا الواجهة.
// ============================================================
export default async function BrokerRequestPage({ params }: { params: { id: string } }) {
  if (!(await canSeeBrokers())) redirect("/dashboard");

  const d = await getBrokerRequestDetail(params.id);
  if (!d) notFound();

  const fact = (label: string, value: React.ReactNode, ltr = false) => (
    <div className="rounded-xl bg-gray-50 p-3">
      <span className="block text-[11px] font-bold uppercase text-gray-400">{label}</span>
      <span className="mt-1 block text-sm text-gray-800" dir={ltr ? "ltr" : undefined}>
        {value ?? "—"}
      </span>
    </div>
  );

  const fmtDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString("ar", { timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short" }) : "—";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/brokers/requests" className="text-sm text-gray-500 hover:text-brand-700">
            ← طلبات الحجز
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">
              الوحدة {d.unit_code ?? "—"} · {d.project_name ?? ""}
            </h1>
            <p className="text-sm text-gray-500">
              {d.company_name} · رُفع {fmtDate(d.created_at)}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full px-4 py-1.5 text-sm font-bold ${BROKER_REQUEST_COLORS[d.status]}`}>{d.status}</span>
          {d.expires_at && isOpenBrokerRequest(d.status) && (
            <span className="text-xs text-gray-500">ينتهي بلا قرار: {fmtDate(d.expires_at)}</span>
          )}
        </div>
      </header>

      <section className="grid grid-cols-1 gap-5 p-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* القرار */}
          {isOpenBrokerRequest(d.status) && (d.can_handle || d.can_approve || d.can_review) && (
            <div className="glass-card p-5">
              <h2 className="mb-3 text-lg font-bold text-gray-800">الإجراء</h2>
              <RequestActions d={d} />
            </div>
          )}

          {/* توصية الـRM — داخلية */}
          {d.rm_recommendation && (
            <div
              className={`rounded-2xl p-4 text-sm ${
                d.rm_recommendation === "أوصي بالرفض" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"
              }`}
            >
              <b>توصية مدير العلاقات ({d.rm_reviewed_by_name ?? d.rm_name ?? "—"}):</b> {d.rm_recommendation}
              {d.rm_review_note && <p className="mt-1">{d.rm_review_note}</p>}
              <p className="mt-1 text-xs opacity-70">{fmtDate(d.rm_reviewed_at)}</p>
            </div>
          )}

          {(d.info_request || d.info_response) && (
            <div className="rounded-2xl bg-purple-50 p-4 text-sm text-purple-900">
              {d.info_request && <p><b>سؤال للوسيط:</b> {d.info_request}</p>}
              {d.info_response ? <p className="mt-1"><b>إجابته:</b> {d.info_response}</p> : <p className="mt-1 text-xs">بانتظار إجابة الوسيط.</p>}
            </div>
          )}

          {d.decision_note && !isOpenBrokerRequest(d.status) && (
            <div className={`rounded-2xl p-4 text-sm ${d.status === "مرفوض" ? "bg-red-50 text-red-800" : "bg-gray-100 text-gray-700"}`}>
              <b>{d.decided_by_name ?? "القرار"}:</b> {d.decision_note}
              <span className="ms-2 text-xs opacity-70">{fmtDate(d.decided_at)}</span>
            </div>
          )}

          {/* الوحدة والسعر */}
          <div className="glass-card p-5">
            <h2 className="mb-3 text-lg font-bold text-gray-800">الوحدة والسعر</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {fact("الوحدة", `${d.unit_code ?? "—"}${d.node_path ? ` · ${d.node_path}` : ""}`)}
              {fact("النوع والمساحة", `${d.unit_type ?? "—"}${d.space_m2 ? ` · ${d.space_m2} م²` : ""}`)}
              {fact("حالة الوحدة الآن", d.unit_status)}
              {fact("خطة الدفع", d.payment_plan)}
              {fact("سعر الوحدة يوم الطلب", formatPrice(Number(d.unit_price ?? 0)), true)}
              {fact("السعر المطلوب", d.requested_price ? formatPrice(Number(d.requested_price)) : "سعر الوحدة", true)}
              {fact(
                "الخصم",
                d.discount ? `${formatPrice(Number(d.discount))} (${d.discount_pct}٪)` : "لا خصم",
                true
              )}
              {d.unit_price_now != null && Number(d.unit_price_now) !== Number(d.unit_price) &&
                fact("سعر الوحدة اليوم", formatPrice(Number(d.unit_price_now)), true)}
            </div>
            {d.note && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">ملاحظة الوسيط: {d.note}</p>}
            {d.reservation_id && (
              <Link href={`/dashboard/reservations/${d.reservation_id}`}
                className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-brand-700 hover:underline">
                فتح الحجز ومتابعة البيع ←
                {d.reservation_status && (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs ${RESERVATION_STATUS_COLORS[d.reservation_status] ?? "bg-gray-100"}`}>
                    {d.reservation_status}
                  </span>
                )}
              </Link>
            )}
          </div>

          {/* الخطّ الزمني */}
          <div className="glass-card p-5">
            <h2 className="mb-4 text-lg font-bold text-gray-800">الخطّ الزمني</h2>
            <BrokerRequestTimeline events={d.events} />
          </div>
        </div>

        <div className="space-y-5">
          <div className="glass-card space-y-3 p-5">
            <h2 className="text-lg font-bold text-gray-800">الأطراف</h2>
            {fact("الشركة الوسيطة", <Link className="text-brand-700 hover:underline" href={`/dashboard/brokers/${d.company_id}`}>{d.company_name}</Link>)}
            {fact("رفعه", d.requested_by_name)}
            {fact("مدير العلاقات", d.rm_name)}
            {fact("مشرف المشروع (صاحب القرار)", d.supervisor_name)}
            {d.handled_by_name && fact("استلمه", d.handled_by_name)}
          </div>

          <div className="glass-card space-y-3 p-5">
            <h2 className="text-lg font-bold text-gray-800">العميل</h2>
            {fact("الاسم والهاتف", <>
              <Link className="text-brand-700 hover:underline" href={`/dashboard/clients/${d.client_id}`}>{d.client_name}</Link>
              {d.client_phone && <span className="ms-2 text-xs text-gray-500" dir="ltr">{d.client_phone}</span>}
            </>)}
            {d.client && (
              <div className="grid grid-cols-2 gap-2">
                {fact("المرحلة", d.client.stage)}
                {fact("تواصل", `${d.client.contact_count ?? 0} مرة`)}
                {fact("أُدخل", d.client.created_at?.slice(0, 10), true)}
                {fact("مهلة الوسيط", d.client.broker_deadline, true)}
              </div>
            )}
            {(d.client_activities?.length ?? 0) > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-bold text-gray-500">آخر التواصل</h3>
                <ul className="space-y-1 text-xs text-gray-600">
                  {d.client_activities!.slice(0, 6).map((a, i) => (
                    <li key={i}>
                      <span dir="ltr" className="text-gray-400">{a.created_at.slice(0, 10)}</span> · {a.type}
                      {a.outcome ? ` · ${a.outcome}` : ""}{a.note ? ` — ${a.note}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(d.client_reservations?.length ?? 0) > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-bold text-gray-500">حجوزات العميل</h3>
                <ul className="space-y-1 text-xs text-gray-600">
                  {d.client_reservations!.map((r) => (
                    <li key={r.id}>
                      <Link className="hover:underline" href={`/dashboard/reservations/${r.id}`}>
                        {r.unit_code ?? "—"} · {r.status} · {r.channel}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {(d.other_requests?.length ?? 0) > 0 && (
            <div className="glass-card p-5">
              <h2 className="mb-2 text-lg font-bold text-gray-800">طلبات أخرى</h2>
              <p className="mb-2 text-xs text-gray-500">للعميل نفسه، أو مفتوحة للشركة نفسها</p>
              <ul className="space-y-1 text-sm">
                {d.other_requests!.map((o) => (
                  <li key={o.id}>
                    <Link href={`/dashboard/brokers/requests/${o.id}`} className="flex justify-between gap-2 rounded-lg px-2 py-1 hover:bg-gray-50">
                      <span>{o.unit_code ?? "—"} · {o.company}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${BROKER_REQUEST_COLORS[o.status] ?? "bg-gray-100"}`}>{o.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
