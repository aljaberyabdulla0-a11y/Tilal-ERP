import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Invoice } from "@/lib/types";
import InvoiceForm from "../../invoice-form";
import { getInvoiceFormOptions } from "../../form-options";

// تعديل فاتورة — للمدير فقط
export default async function EditInvoicePage({
  params,
}: {
  params: { id: string };
}) {
  if (!(await isAdmin())) redirect(`/dashboard/invoices/${params.id}`);

  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!data) notFound();
  const invoice = data as Invoice;

  const { clients, reservations } = await getInvoiceFormOptions();

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href={`/dashboard/invoices/${invoice.id}`}
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← الفاتورة
        </Link>
        <h1 className="text-xl font-bold text-brand-700" dir="ltr">
          {invoice.invoice_number}
        </h1>
      </header>

      <section className="p-6">
        <InvoiceForm
          clients={clients}
          reservations={reservations}
          initial={invoice}
          invoiceId={invoice.id}
        />
      </section>
    </main>
  );
}
