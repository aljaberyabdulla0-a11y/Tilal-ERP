import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/auth";
import { DeveloperInvoice, formatPrice } from "@/lib/types";
import PrintOnLoad from "@/components/reports/print-on-load";
import PrintButton from "./print-button";

// ============================================================
// فاتورة العمولة على المطوّر (sql/103) — الورقة التي تُرسل له
// ليحوّل عمولة تلال عن وحدةٍ بيعت.
//
// تُطبع من المتصفّح (?print=1 يفتح حوار الطباعة): مكتبات PDF على
// الخادم لا تُشكّل العربية. والشريط الجانبي والرأس يختفيان بـprint:hidden.
// ============================================================
export default async function DeveloperInvoicePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { print?: string };
}) {
  if (!(await canManageFinance())) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("developer_invoices")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!data) notFound();
  const inv = data as DeveloperInvoice;

  const [{ data: unit }, { data: project }, { data: res }, { data: sc }] =
    await Promise.all([
      inv.unit_id
        ? supabase
            .from("units")
            .select("unit_code, node_path, unit_type, space_m2, attrs")
            .eq("id", inv.unit_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      inv.project_id
        ? supabase.from("projects").select("name").eq("id", inv.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("reservations")
        .select("down_payment_confirmed_at, clients(name)")
        .eq("id", inv.reservation_id)
        .maybeSingle(),
      supabase
        .from("sale_commissions")
        .select("collected_at")
        .eq("id", inv.sale_commission_id)
        .maybeSingle(),
    ]);

  const u = unit as {
    unit_code: string | null;
    node_path: string | null;
    unit_type: string | null;
    space_m2: number | null;
    attrs: Record<string, unknown> | null;
  } | null;
  const projectName = (project as { name: string } | null)?.name ?? "—";
  const reservation = res as {
    down_payment_confirmed_at: string | null;
    clients: { name: string } | null;
  } | null;
  const buyer = reservation?.clients?.name ?? "—";
  const collectedAt = (sc as { collected_at: string | null } | null)?.collected_at ?? null;
  const barcode = u?.attrs?.barcode ? String(u.attrs.barcode) : null;

  const print = searchParams.print === "1";
  const status = inv.cancelled_at
    ? { label: "ملغاة", cls: "bg-red-100 text-red-700" }
    : collectedAt
    ? { label: "محصّلة", cls: "bg-green-100 text-green-700" }
    : inv.sent_at
    ? { label: "مرسلة — بانتظار التحويل", cls: "bg-amber-100 text-amber-800" }
    : { label: "صادرة — لم تُرسل", cls: "bg-gray-100 text-gray-600" };

  const row = "flex justify-between gap-4 border-b border-gray-100 py-2.5";

  return (
    <main className="min-h-screen bg-gray-50 print:bg-white">
      {print && <PrintOnLoad />}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm print:hidden">
        <div className="flex items-center gap-3">
          {inv.unit_id && (
            <Link
              href={`/dashboard/units/${inv.unit_id}`}
              className="text-sm text-gray-500 hover:text-brand-700"
            >
              ← الوحدة
            </Link>
          )}
          <h1 className="text-xl font-bold text-brand-700" dir="ltr">
            {inv.invoice_number}
          </h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>
            {status.label}
          </span>
        </div>
        <PrintButton />
      </div>

      <section className="p-6 print:p-0">
        <article className="relative mx-auto [-webkit-print-color-adjust:exact] [print-color-adjust:exact] max-w-3xl rounded-2xl bg-white p-10 shadow-sm print:max-w-none print:rounded-none print:p-8 print:shadow-none">
          {inv.cancelled_at && (
            <p className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <b>فاتورة ملغاة</b> — {inv.cancel_reason}
            </p>
          )}

          {/* الرأس */}
          <header className="flex items-start justify-between gap-6 border-b-2 border-brand-600 pb-6">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="تلال العقارية" className="h-20 w-auto" />
              <p className="mt-2 text-sm font-bold text-gray-800">تلال العقارية</p>
              <p className="text-xs text-gray-500">Tilal Real Estate</p>
            </div>
            <div className="text-end">
              <h2 className="text-2xl font-extrabold text-brand-700">فاتورة عمولة</h2>
              <p className="text-xs uppercase tracking-wide text-gray-400">
                Commission Invoice
              </p>
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex justify-end gap-2">
                  <dt className="text-gray-500">رقم الفاتورة</dt>
                  <dd className="font-bold text-gray-800" dir="ltr">
                    {inv.invoice_number}
                  </dd>
                </div>
                <div className="flex justify-end gap-2">
                  <dt className="text-gray-500">تاريخ الإصدار</dt>
                  <dd className="font-medium text-gray-800" dir="ltr">
                    {inv.issue_date}
                  </dd>
                </div>
                {inv.due_date && (
                  <div className="flex justify-end gap-2">
                    <dt className="text-gray-500">تاريخ الاستحقاق</dt>
                    <dd className="font-medium text-gray-800" dir="ltr">
                      {inv.due_date}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </header>

          {/* إلى */}
          <div className="mt-6 rounded-xl bg-gray-50 p-4 print:border print:border-gray-200 print:bg-white">
            <p className="text-xs text-gray-500">إلى السادة</p>
            <p className="mt-1 text-lg font-bold text-gray-800">{inv.developer_name}</p>
            <p className="mt-1 text-xs text-gray-500">المطوّر العقاري — مشروع {projectName}</p>
          </div>

          <p className="mt-6 text-sm leading-relaxed text-gray-700">
            نرجو تحويل عمولة تلال العقارية عن بيع الوحدة المبيّنة أدناه، وفق
            النسبة المتّفق عليها من سعر البيع.
          </p>

          {/* الوحدة والصفقة */}
          <div className="mt-4 text-sm">
            <div className={row}>
              <span className="text-gray-500">المشروع</span>
              <span className="font-medium text-gray-800">{projectName}</span>
            </div>
            <div className={row}>
              <span className="text-gray-500">الوحدة</span>
              <span className="font-medium text-gray-800" dir="ltr">
                {u?.node_path || u?.unit_code || "—"}
              </span>
            </div>
            {barcode && barcode !== u?.node_path && (
              <div className={row}>
                <span className="text-gray-500">رمز الوحدة</span>
                <span className="font-medium text-gray-800" dir="ltr">{barcode}</span>
              </div>
            )}
            {u?.unit_type && (
              <div className={row}>
                <span className="text-gray-500">النوع</span>
                <span className="font-medium text-gray-800">
                  {u.unit_type}
                  {u.space_m2 ? <span dir="ltr"> · {u.space_m2} م²</span> : null}
                </span>
              </div>
            )}
            <div className={row}>
              <span className="text-gray-500">المشتري</span>
              <span className="font-medium text-gray-800">{buyer}</span>
            </div>
            {reservation?.down_payment_confirmed_at && (
              <div className={row}>
                <span className="text-gray-500">تاريخ تأكيد المقدمة</span>
                <span className="font-medium text-gray-800" dir="ltr">
                  {reservation.down_payment_confirmed_at.slice(0, 10)}
                </span>
              </div>
            )}
          </div>

          {/* الحساب */}
          <table className="mt-6 w-full text-sm">
            <thead>
              <tr className="bg-brand-600 text-white print:bg-brand-600">
                <th className="px-4 py-2.5 text-start font-semibold">البيان</th>
                <th className="px-4 py-2.5 text-start font-semibold">سعر البيع</th>
                <th className="px-4 py-2.5 text-start font-semibold">النسبة</th>
                <th className="px-4 py-2.5 text-end font-semibold">المبلغ (د.ع)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-200">
                <td className="px-4 py-3 text-gray-800">
                  عمولة تسويق وبيع — الوحدة{" "}
                  <span dir="ltr">{u?.unit_code ?? ""}</span>
                </td>
                <td className="px-4 py-3 text-gray-700" dir="ltr">
                  {formatPrice(inv.sale_price)}
                </td>
                <td className="px-4 py-3 text-gray-700" dir="ltr">
                  {inv.rate}%
                </td>
                <td className="px-4 py-3 text-end font-semibold text-gray-800" dir="ltr">
                  {formatPrice(inv.amount)}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="px-4 pt-4 text-end font-bold text-gray-700">
                  المجموع المستحقّ
                </td>
                <td className="px-4 pt-4 text-end text-xl font-extrabold text-brand-700" dir="ltr">
                  {formatPrice(inv.amount)} IQD
                </td>
              </tr>
            </tfoot>
          </table>

          {inv.notes && (
            <div className="mt-8">
              <p className="text-xs font-semibold text-gray-500">ملاحظات / تعليمات الدفع</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{inv.notes}</p>
            </div>
          )}

          <p className="mt-8 text-xs text-gray-400">
            يُرجى ذكر رقم الفاتورة <b dir="ltr">{inv.invoice_number}</b> عند التحويل.
          </p>

          {/* التوقيع والختم */}
          <footer className="mt-16 grid grid-cols-2 gap-10 text-center text-xs text-gray-500">
            <div>
              <div className="mb-2 h-16 border-b border-gray-300" />
              المحاسب
            </div>
            <div>
              <div className="mb-2 h-16 border-b border-gray-300" />
              الختم والتوقيع — تلال العقارية
            </div>
          </footer>
        </article>
      </section>
    </main>
  );
}
