import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canSeeTeam, isAdmin } from "@/lib/auth";
import {
  Reservation,
  RESERVATION_STATUS_COLORS,
  SALE_CHANNEL_COLORS,
  formatPrice,
} from "@/lib/types";
import DeleteReservationButton from "../delete-reservation-button";
import SaleChannelSwitch from "./sale-channel";

// صفحة تفاصيل حجز
export default async function ReservationDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reservations")
    .select("*, clients(name), units(project, unit_code, project_id)")
    .eq("id", params.id)
    .single();

  if (!data) notFound();
  // قناة البيع (sql/128) — من جلب العميل، تُختم في القاعدة عند الحجز
  const r = data as Reservation & {
    sale_channel?: string | null;
    broker_company_id?: string | null;
    broker_request_id?: string | null;
    units?: { project: string | null; unit_code: string | null; project_id?: string | null } | null;
  };
  const admin = await isAdmin();

  const channel = r.sale_channel ?? "مباشر";
  const [{ data: brokerCo }, { data: assigned }] = await Promise.all([
    r.broker_company_id
      ? supabase.from("broker_companies").select("id, name").eq("id", r.broker_company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin && r.status === "حجز" && r.units?.project_id
      ? supabase
          .from("broker_company_projects")
          .select("company_id, broker_companies(id, name)")
          .eq("project_id", r.units.project_id)
      : Promise.resolve({ data: [] }),
  ]);
  const companies = ((assigned ?? []) as unknown as { broker_companies: { id: string; name: string } | null }[])
    .map((a) => a.broker_companies)
    .filter(Boolean) as { id: string; name: string }[];
  // ما يراه المشرف من حجوزات هو نطاقه أصلاً (سياسة القاعدة تفلترها)
  const canEdit = await canSeeTeam();

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="border-b border-gray-100 py-3">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-gray-800">{value || "—"}</dd>
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/reservations"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← الحجوزات
          </Link>
          <h1 className="text-xl font-bold text-brand-700">
            حجز — {r.clients?.name ?? ""}
          </h1>
        </div>
        {canEdit && (
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/reservations/${r.id}/edit`}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              تعديل
            </Link>
            {/* الحذف للمدير وحده */}
            {admin && <DeleteReservationButton id={r.id} />}
          </div>
        )}
      </header>

      <section className="p-6">
        <div className="max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Field
              label="العميل"
              value={
                <Link
                  href={`/dashboard/clients/${r.client_id}`}
                  className="text-brand-700 hover:underline"
                >
                  {r.clients?.name ?? "—"}
                </Link>
              }
            />
            <Field
              label="الوحدة العقارية"
              value={
                <Link
                  href={`/dashboard/units/${r.unit_id}`}
                  className="text-brand-700 hover:underline"
                >
                  {r.units
                    ? `${r.units.project}${
                        r.units.unit_code ? " - " + r.units.unit_code : ""
                      }`
                    : "—"}
                </Link>
              }
            />
            <Field
              label="تاريخ الحجز"
              value={
                r.reservation_date ? (
                  <span dir="ltr" className="inline-block text-start">
                    {r.reservation_date}
                  </span>
                ) : null
              }
            />
            <Field
              label="حالة الحجز"
              value={
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    RESERVATION_STATUS_COLORS[r.status] ??
                    "bg-gray-100 text-gray-600"
                  }`}
                >
                  {r.status}
                </span>
              }
            />
            <Field
              label="قناة البيع"
              value={
                <>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      SALE_CHANNEL_COLORS[channel] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {channel}
                  </span>
                  {brokerCo && (
                    <Link href={`/dashboard/brokers/${brokerCo.id}`} className="ms-2 text-sm text-brand-700 hover:underline">
                      {brokerCo.name}
                    </Link>
                  )}
                  {r.broker_request_id && (
                    <Link href={`/dashboard/brokers/requests/${r.broker_request_id}`} className="ms-2 text-xs text-gray-500 hover:underline">
                      طلب الوسيط
                    </Link>
                  )}
                  {admin && r.status === "حجز" && (companies.length > 0 || channel === "وسيط") && (
                    <SaleChannelSwitch
                      reservationId={r.id}
                      channel={channel}
                      companyId={r.broker_company_id ?? null}
                      companies={companies}
                    />
                  )}
                </>
              }
            />
            <Field
              label="المبلغ المدفوع (د.ع)"
              value={
                r.amount !== null ? (
                  <span dir="ltr" className="inline-block text-start">
                    {formatPrice(r.amount)}
                  </span>
                ) : null
              }
            />
          </dl>

          <div className="mt-4">
            <dt className="text-sm text-gray-500">ملاحظات</dt>
            <dd className="mt-1 min-h-[80px] whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-gray-800">
              {r.notes || "لا توجد ملاحظات."}
            </dd>
          </div>
        </div>
      </section>
    </main>
  );
}
