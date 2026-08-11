import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Invoice, invoiceStatus, formatPrice } from "@/lib/types";

// قائمة الفواتير مع المدفوع والمتبقي والحالة — للمدير فقط
export default async function InvoicesPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, clients(name), payments(amount)")
    .order("created_at", { ascending: false });

  const invoices = (data ?? []) as Invoice[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">الفواتير</h1>
        </div>
        <Link
          href="/dashboard/invoices/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + فاتورة جديدة
        </Link>
      </header>

      <section className="p-6">
        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            تعذّر جلب الفواتير: {error.message}
            <br />
            تأكّد من تشغيل ملف SQL للفواتير.
          </div>
        )}

        {!error && invoices.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا توجد فواتير بعد — أضف أول فاتورة.
          </div>
        )}

        {!error && invoices.length > 0 && (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[820px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">رقم الفاتورة</th>
                  <th className="px-4 py-3 font-medium">العميل</th>
                  <th className="px-4 py-3 font-medium">التاريخ</th>
                  <th className="px-4 py-3 font-medium">الإجمالي</th>
                  <th className="px-4 py-3 font-medium">المدفوع</th>
                  <th className="px-4 py-3 font-medium">المتبقي</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const paid = (inv.payments ?? []).reduce((s, p) => s + p.amount, 0);
                  const remaining = inv.total_amount - paid;
                  const st = invoiceStatus(inv.total_amount, paid);
                  return (
                    <tr key={inv.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/dashboard/invoices/${inv.id}`}
                          className="text-brand-700 hover:underline"
                          dir="ltr"
                        >
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-800">{inv.clients?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-600" dir="ltr">{inv.issue_date}</td>
                      <td className="px-4 py-3 text-gray-800" dir="ltr">{formatPrice(inv.total_amount)}</td>
                      <td className="px-4 py-3 text-green-700" dir="ltr">{formatPrice(paid)}</td>
                      <td className="px-4 py-3 text-red-700" dir="ltr">{formatPrice(remaining)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!error && invoices.length > 0 && (
          <p className="mt-3 text-sm text-gray-500">عدد الفواتير: {invoices.length}</p>
        )}
      </section>
    </main>
  );
}
