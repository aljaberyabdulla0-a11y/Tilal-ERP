import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getMyEmployee } from "@/lib/hr";
import { canEditUnit } from "@/lib/projects";
import {
  getUnit,
  getUnitEvents,
  getUnitFinance,
  getUnitInvoices,
  getUnitPayments,
  getUnitReservations,
  getUnitTypes,
} from "@/lib/estate";
import {
  JSON_UNIT_FIELDS,
  RESERVATION_STATUS_COLORS,
  UNIT_EVENT_ICONS,
  UNIT_FIELD_LABELS,
  UNIT_STATUS_COLORS,
  UNIT_STATUS_DOTS,
  SaleCommission,
  UnitField,
  formatPrice,
  ownsReservation,
  reservationExpired,
  salePending,
  unitFieldsFor,
} from "@/lib/types";
import DeleteUnitButton from "../delete-unit-button";
import DealCommission from "@/components/deal-commission";
import SaleRequest from "@/components/sale-request";
import UnitActions from "./unit-actions";

// تسميات الحقول الإضافية القادمة من ملفات الرفع
const EXTRA_ATTR_LABELS: Record<string, string> = {
  barcode: "الباركود",
  label: "الاسم الكامل",
  building_type: "نوع المبنى",
};

// ============================================================
// صفحة الوحدة — دورة حياتها كاملة في مكان واحد.
//
// المعلومات، والحجز، والبيع، والفواتير، والدفعات، والسجل. كل ما
// يحتاجه من يسأل «ما وضع هذه الوحدة؟» بلا تنقّل بين شاشات.
// ============================================================
export default async function UnitDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  const unit = await getUnit(params.id);
  if (!unit) notFound();

  const admin = await isAdmin();
  const [
    canEdit,
    finance,
    reservations,
    invoices,
    payments,
    events,
    unitTypes,
    user,
    myEmployee,
  ] = await Promise.all([
    canEditUnit(unit.project_id, admin),
    getUnitFinance(unit.id),
    getUnitReservations(unit.id),
    getUnitInvoices(unit.id),
    getUnitPayments(unit.id),
    getUnitEvents(unit.id),
    getUnitTypes(),
    getCurrentUser(),
    getMyEmployee(),
  ]);

  // العميل الحالي: صاحب البيع، وإلا صاحب الحجز القائم
  const active =
    reservations.find((r) => r.status === "بيع مكتمل") ??
    reservations.find((r) => r.status === "حجز") ??
    null;

  // الحجز القائم وحده هو ما يُطلب بيعه أو يُبتّ فيه
  const held = reservations.find((r) => r.status === "حجز") ?? null;

  // الصفقة المكتملة: منها تُستحقّ عمولة تلال عند تأكيد المقدمة (sql/056)
  const sold = reservations.find((r) => r.status === "بيع مكتمل") ?? null;
  const supabase = await createClient();
  const { data: scData } = sold
    ? await supabase
        .from("sale_commissions")
        .select("*")
        .eq("reservation_id", sold.id)
        .maybeSingle()
    : { data: null };
  const saleCommission = (scData as SaleCommission) ?? null;

  const category =
    unitTypes.find((t) => t.name === unit.unit_type)?.category ?? "أخرى";
  const fields = unitFieldsFor(category);

  const colValue: Record<string, number | null> = {
    space_m2: unit.space_m2,
    land_area_m2: unit.land_area_m2,
    built_area_m2: unit.built_area_m2,
    rooms: unit.rooms,
    bathrooms: unit.bathrooms,
    floors_count: unit.floors_count,
    parking_spaces: unit.parking_spaces,
  };

  function fieldValue(f: UnitField): string {
    if (JSON_UNIT_FIELDS.includes(f)) {
      const raw = unit!.attrs?.[f];
      return raw === null || raw === undefined || raw === "" ? "—" : String(raw);
    }
    const v = colValue[f];
    return v === null || v === undefined ? "—" : String(v);
  }

  // ما في attrs ولا يظهر ضمن حقول هذا النوع — لا يُهمل بل يُعرض أسفلها
  const extraAttrs = Object.entries(unit.attrs ?? {}).filter(
    ([k, v]) =>
      v !== null &&
      v !== "" &&
      !(fields as string[]).includes(k),
  );

  const clientNameOf = (r: (typeof reservations)[number]) => r.clients?.name ?? "—";

  const card = "rounded-2xl bg-white p-6 shadow-sm";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href={
              unit.project_id
                ? `/dashboard/projects/${unit.project_id}`
                : "/dashboard/units"
            }
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← {unit.project || "الوحدات"}
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`h-3 w-3 rounded-full ${
                  UNIT_STATUS_DOTS[unit.status] ?? "bg-gray-300"
                }`}
              />
              <h1 className="text-xl font-bold text-brand-700">
                {unit.unit_code || "وحدة بلا رقم"}
              </h1>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  UNIT_STATUS_COLORS[unit.status] ?? "bg-gray-100 text-gray-600"
                }`}
              >
                {unit.status}
              </span>
            </div>
            <p className="text-sm text-gray-500">
              {unit.node_path || unit.project} · {unit.unit_type}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <UnitActions
            unitId={unit.id}
            status={unit.status}
            blockedReason={unit.blocked_reason}
            activeReservationId={held?.id ?? null}
            isAdmin={admin}
            canEdit={canEdit}
            salePending={held ? salePending(held) : false}
          />

          {/* الموظف يطلب البيع، والإدارة تبتّ — كلاهما من هنا (sql/050) */}
          {held && (
            <SaleRequest
              reservationId={held.id}
              status={held.status}
              requestStatus={held.sale_request_status}
              requestNote={held.sale_request_note}
              rejectReason={held.sale_reject_reason}
              canDecide={canEdit}
              canRequest={
                canEdit || ownsReservation(held, user?.id, myEmployee?.id)
              }
            />
          )}
          {canEdit && unit.project_id && (
            <Link
              href={`/dashboard/units/${unit.id}/edit`}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              تعديل
            </Link>
          )}
          {admin && (
            <DeleteUnitButton
              id={unit.id}
              label={`${unit.project} ${unit.unit_code ?? ""}`}
            />
          )}
        </div>
      </header>

      <section className="space-y-5 p-6">
        {unit.status === "موقوفة" && unit.blocked_reason && (
          <div className="rounded-2xl border-s-4 border-s-gray-400 bg-gray-100 p-4 text-sm text-gray-700">
            <b>هذه الوحدة موقوفة:</b> {unit.blocked_reason} — لا تُحجز ولا تُباع
            حتى يرفع المدير الإيقاف.
          </div>
        )}

        {/* المقدمة وعمولة الصفقة — مسار المال الحقيقي (sql/056) */}
        {sold && (
          <DealCommission
            reservation={sold}
            saleCommission={saleCommission}
            canManage={canEdit}
            isAdmin={admin}
          />
        )}

        {/* الوضع المالي */}
        {finance && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="glass-card border-s-4 border-s-brand-500 p-5">
              <span className="text-sm text-gray-500">سعر الوحدة</span>
              <p className="mt-1 text-xl font-bold text-gray-800" dir="ltr">
                {formatPrice(unit.price)}
              </p>
              {unit.price_per_m2 && (
                <p className="mt-1 text-[11px] text-gray-400" dir="ltr">
                  {formatPrice(unit.price_per_m2)} / م²
                </p>
              )}
            </div>
            <div className="glass-card border-s-4 border-s-blue-500 p-5">
              <span className="text-sm text-gray-500">المفوتر</span>
              <p className="mt-1 text-xl font-bold text-blue-700" dir="ltr">
                {formatPrice(finance.invoiced)}
              </p>
            </div>
            <div className="glass-card border-s-4 border-s-green-500 p-5">
              <span className="text-sm text-gray-500">المدفوع</span>
              <p className="mt-1 text-xl font-bold text-green-700" dir="ltr">
                {formatPrice(finance.paid)}
              </p>
            </div>
            <div
              className={`glass-card border-s-4 p-5 ${
                finance.remaining > 0 ? "border-s-amber-500" : "border-s-gray-300"
              }`}
            >
              <span className="text-sm text-gray-500">المتبقي</span>
              <p
                className={`mt-1 text-xl font-bold ${
                  finance.remaining > 0 ? "text-amber-700" : "text-gray-500"
                }`}
                dir="ltr"
              >
                {formatPrice(finance.remaining)}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            {/* المواصفات */}
            <div className={card}>
              <h2 className="mb-4 text-sm font-bold text-gray-700">المواصفات</h2>
              <dl className="grid grid-cols-2 gap-x-8 sm:grid-cols-3">
                {fields.map((f) => (
                  <div key={f} className="border-b border-gray-100 py-3">
                    <dt className="text-xs text-gray-500">{UNIT_FIELD_LABELS[f]}</dt>
                    <dd className="mt-0.5 font-medium text-gray-800">
                      {fieldValue(f)}
                    </dd>
                  </div>
                ))}
                {unit.payment_plan && (
                  <div className="col-span-2 border-b border-gray-100 py-3 sm:col-span-3">
                    <dt className="text-xs text-gray-500">خطة الدفع</dt>
                    <dd className="mt-0.5 font-medium text-gray-800">
                      {unit.payment_plan}
                    </dd>
                  </div>
                )}
              </dl>
              {/* بيانات جاءت مع الملف ولا تخصّ هذا النوع — تُعرض ولا
                  تُهمل: الباركود واسم المطوّر مفاتيح للمطابقة معه. */}
              {extraAttrs.length > 0 && (
                <dl className="mt-4 grid grid-cols-2 gap-x-8 border-t border-gray-100 pt-4 sm:grid-cols-3">
                  {extraAttrs.map(([k, v]) => (
                    <div key={k} className="py-2">
                      <dt className="text-xs text-gray-500">
                        {EXTRA_ATTR_LABELS[k] ?? k}
                      </dt>
                      <dd className="mt-0.5 break-words text-sm font-medium text-gray-700">
                        {String(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {unit.notes && (
                <p className="mt-4 whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
                  {unit.notes}
                </p>
              )}
            </div>

            {/* الحجوزات والبيع */}
            <div className={card}>
              <h2 className="mb-4 text-sm font-bold text-gray-700">
                الحجوزات والبيع
              </h2>
              {reservations.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">
                  لا حجوزات على هذه الوحدة.
                </p>
              ) : (
                <div className="space-y-3">
                  {reservations.map((r) => (
                    <Link
                      key={r.id}
                      href={`/dashboard/reservations/${r.id}`}
                      className={`block rounded-xl border-s-4 border border-gray-200 p-4 transition hover:shadow-sm ${
                        reservationExpired(r)
                          ? "border-s-red-500"
                          : r.status === "بيع مكتمل"
                          ? "border-s-green-500"
                          : r.status === "حجز"
                          ? "border-s-amber-500"
                          : "border-s-gray-300"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-gray-800">
                          {clientNameOf(r)}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            RESERVATION_STATUS_COLORS[r.status] ??
                            "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {r.status}
                        </span>
                        {reservationExpired(r) && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                            انتهت المهلة
                          </span>
                        )}
                        {r.amount !== null && (
                          <span
                            className="ms-auto text-sm font-semibold text-brand-700"
                            dir="ltr"
                          >
                            {formatPrice(r.amount)} د.ع
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {r.reservation_date ?? "—"}
                        {r.expiry_date ? ` · تنتهي ${r.expiry_date}` : ""}
                        {r.agent_name ? ` · ${r.agent_name}` : ""}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* الفواتير */}
            <div className={card}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-bold text-gray-700">الفواتير</h2>
                {admin && active && (
                  <Link
                    href={`/dashboard/invoices/new?client=${active.client_id}&reservation=${active.id}`}
                    className="text-xs font-semibold text-brand-600 hover:underline"
                  >
                    + فاتورة
                  </Link>
                )}
              </div>
              {invoices.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">
                  لا فواتير مرتبطة بهذه الوحدة.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-start text-sm">
                    <thead className="border-b text-gray-500">
                      <tr>
                        <th className="py-2 text-start font-medium">الرقم</th>
                        <th className="py-2 text-start font-medium">التاريخ</th>
                        <th className="py-2 text-start font-medium">الإجمالي</th>
                        <th className="py-2 text-start font-medium">المدفوع</th>
                        <th className="py-2 text-start font-medium">المتبقي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => {
                        const paid = (inv.payments ?? []).reduce(
                          (s, p) => s + Number(p.amount),
                          0,
                        );
                        const rest = Number(inv.total_amount) - paid;
                        return (
                          <tr key={inv.id} className="border-b last:border-0">
                            <td className="py-2">
                              <Link
                                href={`/dashboard/invoices/${inv.id}`}
                                className="font-medium text-brand-700 hover:underline"
                              >
                                {inv.invoice_number}
                              </Link>
                            </td>
                            <td className="py-2 text-gray-600">
                              {inv.issue_date ?? "—"}
                            </td>
                            <td className="py-2 text-gray-800" dir="ltr">
                              {formatPrice(inv.total_amount)}
                            </td>
                            <td className="py-2 text-green-700" dir="ltr">
                              {formatPrice(paid)}
                            </td>
                            <td
                              className={
                                rest > 0
                                  ? "py-2 font-semibold text-amber-700"
                                  : "py-2 text-gray-400"
                              }
                              dir="ltr"
                            >
                              {formatPrice(rest)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* الدفعات */}
            {payments.length > 0 && (
              <div className={card}>
                <h2 className="mb-4 text-sm font-bold text-gray-700">الدفعات</h2>
                <div className="space-y-2">
                  {payments.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0"
                    >
                      <div>
                        <span className="text-sm font-medium text-gray-800">
                          {p.invoice_number}
                        </span>
                        <p className="text-xs text-gray-500">
                          {p.payment_date}
                          {p.method ? ` · ${p.method}` : ""}
                        </p>
                      </div>
                      <span
                        className="text-sm font-semibold text-green-700"
                        dir="ltr"
                      >
                        {formatPrice(p.amount)} د.ع
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* السجل */}
          <div className={card + " h-fit"}>
            <h2 className="mb-4 text-sm font-bold text-gray-700">
              سجل الوحدة
              <span className="ms-2 font-normal text-gray-400">
                ({events.length})
              </span>
            </h2>
            {events.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">لا أحداث بعد.</p>
            ) : (
              <ol className="max-h-[560px] space-y-4 overflow-y-auto pe-1">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                      <span className="material-symbols-outlined text-[18px]">
                        {UNIT_EVENT_ICONS[e.kind] ?? "history"}
                      </span>
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{e.kind}</p>
                      {e.detail && (
                        <p className="text-xs text-gray-600">{e.detail}</p>
                      )}
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {e.actor_name ?? "النظام"} ·{" "}
                        {new Date(e.created_at).toLocaleString("ar-IQ", {
                          timeZone: "Asia/Baghdad",
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
