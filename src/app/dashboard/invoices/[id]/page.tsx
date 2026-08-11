import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Invoice, Payment, invoiceStatus, formatPrice } from "@/lib/types";
import AddPayment from "../add-payment";
import DeleteInvoiceButton from "../delete-invoice-button";
import DeletePaymentButton from "../delete-payment-button";

export default async function InvoiceDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("*, clients(name)")
    .eq("id", params.id)
    .single();

  if (!data) notFound();
  const inv = data as Invoice;
  const admin = await isAdmin();

  const { data: pays } = await supabase
    .from("payments")
    .select("*")
    .eq("invoice_id", inv.id)
    .order("payment_date", { ascending: false });
  const payments = (pays ?? []) as Payment[];

  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = inv.total_amount - paid;
  const st = invoiceStatus(inv.total_amount, paid);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/invoices" className="text-sm text-gray-500 hover:text-brand-700">
            ← الفواتير
          </Link>
          <h1 className="text-xl font-bold text-brand-700" dir="ltr">
            {inv.invoice_number}
          </h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.color}`}>
            {st.label}
          </span>
        </div>
        {admin && (
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/invoices/${inv.id}/edit`}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              تعديل
            </Link>
            <DeleteInvoiceButton id={inv.id} />
          </div>
        )}
      </header>

      <section className="space-y-6 p-6">
        {/* بيانات الفاتورة + الملخص */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-2xl bg-white p-6 shadow-sm lg:col-span-2">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-gray-500">العميل</dt><dd className="font-medium text-gray-800">{inv.clients?.name ?? "—"}</dd></div>
              <div><dt className="text-gray-500">تاريخ الإصدار</dt><dd className="font-medium text-gray-800" dir="ltr">{inv.issue_date || "—"}</dd></div>
              <div><dt className="text-gray-500">تاريخ الاستحقاق</dt><dd className="font-medium text-gray-800" dir="ltr">{inv.due_date || "—"}</dd></div>
              <div><dt className="text-gray-500">المبلغ الإجمالي</dt><dd className="font-medium text-gray-800" dir="ltr">{formatPrice(inv.total_amount)}</dd></div>
            </dl>
            {inv.notes && (
              <div className="mt-4">
                <dt className="text-sm text-gray-500">ملاحظات</dt>
                <dd className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-gray-800">{inv.notes}</dd>
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">الإجمالي</span>
                <b dir="ltr">{formatPrice(inv.total_amount)}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">المدفوع</span>
                <b className="text-green-700" dir="ltr">{formatPrice(paid)}</b>
              </div>
              <div className="flex justify-between border-t pt-3">
                <span className="text-sm font-semibold text-gray-700">المتبقّي</span>
                <b className="text-lg text-red-700" dir="ltr">{formatPrice(remaining)}</b>
              </div>
            </div>
          </div>
        </div>

        {/* المدفوعات */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h3 className="mb-1 text-lg font-semibold text-gray-800">الدفعات (الأقساط)</h3>
          <p className="mb-3 text-xs text-gray-400">
            🔗 كل دفعة تُرحّل تلقائياً كإيراد في المحاسبة.
          </p>
          <div className="mb-4">
            <AddPayment invoiceId={inv.id} remaining={remaining > 0 ? remaining : 0} />
          </div>

          {payments.length === 0 ? (
            <p className="text-sm text-gray-400">لا توجد دفعات بعد.</p>
          ) : (
            <table className="w-full text-start text-sm">
              <thead className="border-b text-gray-500">
                <tr>
                  <th className="pb-2 font-medium">التاريخ</th>
                  <th className="pb-2 font-medium">الطريقة</th>
                  <th className="pb-2 font-medium">المبلغ</th>
                  {admin && <th className="pb-2 font-medium"></th>}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2.5 text-gray-600" dir="ltr">{p.payment_date}</td>
                    <td className="py-2.5 text-gray-600">
                      {p.method || "—"}
                      {p.journal_entry_id && (
                        <span className="ms-2 text-xs text-green-600">✓ مُرحّل</span>
                      )}
                    </td>
                    <td className="py-2.5 font-medium text-green-700" dir="ltr">{formatPrice(p.amount)}</td>
                    {admin && (
                      <td className="py-2.5 text-end">
                        <DeletePaymentButton id={p.id} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}
