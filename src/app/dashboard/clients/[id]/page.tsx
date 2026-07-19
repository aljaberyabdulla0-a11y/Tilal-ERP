import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Client, toIntlPhone, toLocalPhone } from "@/lib/types";
import DeleteClientButton from "../delete-client-button";

// صفحة تفاصيل عميل واحد — تعرض كل المعلومات المسجّلة
export default async function ClientDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!data) notFound();
  const c = data as Client;

  // التعديل والحذف للمدراء فقط
  const admin = await isAdmin();

  // صفّان للهاتف: المحلي والدولي معاً للسهولة
  const phoneLocal = c.phone ? toLocalPhone(c.phone) : null;
  const phoneIntl = c.phone ? toIntlPhone(c.phone) : null;

  // مكوّن صغير لعرض حقل (عنوان + قيمة)
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
            href="/dashboard/clients"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← العملاء
          </Link>
          <h1 className="text-xl font-bold text-brand-700">{c.name}</h1>
        </div>
        {/* التعديل والحذف للمدراء فقط */}
        {admin && (
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/clients/${c.id}/edit`}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              تعديل
            </Link>
            <DeleteClientButton id={c.id} name={c.name} />
          </div>
        )}
      </header>

      <section className="p-6">
        <div className="max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Field label="الاسم" value={c.name} />
            <Field
              label="رقم الهاتف"
              value={
                c.phone ? (
                  <span dir="ltr" className="inline-block text-left">
                    {phoneLocal}
                    <span className="block text-sm font-normal text-gray-400">
                      {phoneIntl}
                    </span>
                  </span>
                ) : null
              }
            />
            <Field label="المحافظة" value={c.governorate} />
            <Field label="المنطقة" value={c.area} />
            <Field label="الغرض من الشراء" value={c.purchase_purpose} />
            <Field label="طريقة الدفع" value={c.payment_method} />
            <Field label="مصدر العميل" value={c.source} />
            <Field label="موظف المبيعات" value={c.sales_employee} />
            <Field
              label="التاريخ"
              value={
                c.entry_date ? (
                  <span dir="ltr" className="inline-block text-left">
                    {c.entry_date}
                  </span>
                ) : null
              }
            />
          </dl>

          {/* الملاحظات في مساحة عريضة */}
          <div className="mt-4">
            <dt className="text-sm text-gray-500">ملاحظات</dt>
            <dd className="mt-1 min-h-[80px] whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-gray-800">
              {c.notes || "لا توجد ملاحظات."}
            </dd>
          </div>
        </div>
      </section>
    </main>
  );
}
