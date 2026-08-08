import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import {
  Client,
  PAYMENT_METHOD_COLORS,
  sinceColor,
  sinceLabel,
} from "@/lib/types";
import DeleteClientButton from "./delete-client-button";
import CrmTabs from "../crm/crm-tabs";
import StageSelect from "@/components/stage-select";

// صفحة قائمة العملاء (CRM)
// تقرأ العملاء من قاعدة البيانات وتعرضهم في جدول، مع بحث بالاسم أو الجوال
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const supabase = await createClient();

  // نص البحث — ننظّفه من الرموز التي قد تكسر الاستعلام
  const q = (searchParams.q ?? "").trim().replace(/[%,()]/g, "");

  let query = supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });

  // إذا كتب المستخدم كلمة بحث، نفلتر بالاسم أو رقم الهاتف
  if (q) {
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
  }

  const { data, error } = await query;
  const clients = (data ?? []) as Client[];

  // هل المستخدم الحالي مدير؟ (لإظهار أزرار التعديل والحذف)
  const admin = await isAdmin();

  return (
    <main className="min-h-screen bg-gray-50">
      {/* الشريط العلوي */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">CRM</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* تبديل العرض: قائمة / لوحة */}
          <div className="flex rounded-lg border p-0.5 text-sm">
            <span className="rounded-md bg-brand-600 px-3 py-1.5 font-semibold text-white">
              قائمة
            </span>
            <Link
              href="/dashboard/clients/board"
              className="rounded-md px-3 py-1.5 text-gray-500 hover:bg-gray-100"
            >
              لوحة المبيعات
            </Link>
          </div>
          {/* الاستيراد والتصدير للإدارة فقط */}
          {admin && (
            <>
              <Link
                href="/dashboard/clients/import"
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                <span className="material-symbols-outlined text-[18px]">upload_file</span>
                استيراد اكسل
              </Link>
              <a
                href="/api/clients/export"
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                تصدير اكسل
              </a>
            </>
          )}
          <Link
            href="/dashboard/clients/new"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            + عميل جديد
          </Link>
        </div>
      </header>

      <CrmTabs active="clients" />

      <section className="p-6">
        {/* توضيح للموظف: القائمة تعرض عملاءه فقط */}
        {!admin && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
            <span className="material-symbols-outlined text-[18px]">lock</span>
            <span>
              تشوف هنا العملاء الذين أضفتهم أو المُسندين لك فقط. لعرض عميل غير ظاهر
              لك، راجع الإدارة.
            </span>
          </div>
        )}

        {/* صندوق البحث */}
        <form className="mb-4 flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="ابحث بالاسم أو رقم الهاتف..."
            className="w-full max-w-sm rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <button
            type="submit"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-100"
          >
            بحث
          </button>
          {q && (
            <Link
              href="/dashboard/clients"
              className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              مسح
            </Link>
          )}
        </form>

        {/* رسالة خطأ إن فشل جلب البيانات (غالباً: الجدول غير محدّث بعد) */}
        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            تعذّر جلب العملاء: {error.message}
            <br />
            تأكّد من تشغيل ملف SQL الأحدث في Supabase لتحديث جدول العملاء.
          </div>
        )}

        {/* لا يوجد عملاء */}
        {!error && clients.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            {q ? "لا يوجد عميل مطابق للبحث." : "لا يوجد عملاء بعد — أضف أول عميل."}
          </div>
        )}

        {/* الجدول */}
        {!error && clients.length > 0 && (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[1040px] text-right text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الاسم</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">الهاتف</th>
                  <th className="px-4 py-3 font-medium">المحافظة</th>
                  <th className="px-4 py-3 font-medium">المنطقة</th>
                  <th className="px-4 py-3 font-medium">الغرض</th>
                  <th className="px-4 py-3 font-medium">طريقة الدفع</th>
                  <th className="px-4 py-3 font-medium">المصدر</th>
                  <th className="px-4 py-3 font-medium">موظف المبيعات</th>
                  <th className="px-4 py-3 font-medium">آخر تواصل</th>
                  <th className="px-4 py-3 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/dashboard/clients/${c.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StageSelect clientId={c.id} stage={c.stage} />
                    </td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">
                      {c.phone || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.governorate || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{c.area || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{c.purchase_purpose || "—"}</td>
                    <td className="px-4 py-3">
                      {c.payment_method ? (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            PAYMENT_METHOD_COLORS[c.payment_method] ??
                            "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {c.payment_method}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.source || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{c.sales_employee || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`font-medium ${sinceColor(c.last_contact_at)}`}>
                        {sinceLabel(c.last_contact_at)}
                      </span>
                      {(c.contact_count ?? 0) > 0 && (
                        <span className="block text-xs text-gray-400">
                          {c.contact_count} تواصل
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        href={`/dashboard/clients/${c.id}`}
                        className="ml-3 text-sm text-brand-700 hover:underline"
                      >
                        عرض
                      </Link>
                      {/* التعديل والحذف للمدراء فقط */}
                      {admin && (
                        <>
                          <Link
                            href={`/dashboard/clients/${c.id}/edit`}
                            className="ml-3 text-sm text-brand-700 hover:underline"
                          >
                            تعديل
                          </Link>
                          <DeleteClientButton id={c.id} name={c.name} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* عدّاد */}
        {!error && clients.length > 0 && (
          <p className="mt-3 text-sm text-gray-500">
            الإجمالي: {clients.length} عميل
          </p>
        )}
      </section>
    </main>
  );
}
