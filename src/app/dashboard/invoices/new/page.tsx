import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import InvoiceForm from "../invoice-form";
import { getInvoiceFormOptions } from "../form-options";

export default async function NewInvoicePage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const { clients, reservations } = await getInvoiceFormOptions();

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/invoices" className="text-sm text-gray-500 hover:text-brand-700">
          ← الفواتير
        </Link>
        <h1 className="text-xl font-bold text-brand-700">فاتورة جديدة</h1>
      </header>

      <section className="p-6">
        <InvoiceForm clients={clients} reservations={reservations} />
      </section>
    </main>
  );
}
