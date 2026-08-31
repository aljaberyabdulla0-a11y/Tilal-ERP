import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canSeeTeam, isAdmin } from "@/lib/auth";
import { Invoice, Reservation } from "@/lib/types";
import MoneyTabs from "./money-tabs";

// ============================================================
// المال الداخل: فواتير ومبالغ حجز.
//   المدير : كل شيء، وينشئ ويعدّل.
//   المشرف : ما يخصّ عملاء مشروعه — **قراءة فقط**.
// الفلترة نفسها في القاعدة (سياسات read invoices/reservations in
// scope)، فهذه الصفحة تعرض ما تُرجعه له لا أكثر.
// ============================================================
export default async function InvoicesPage() {
  if (!(await canSeeTeam())) redirect("/dashboard");
  const admin = await isAdmin();

  const supabase = await createClient();
  const [{ data: inv, error }, { data: res }] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, clients(name), payments(amount)")
      .order("created_at", { ascending: false }),
    // مبالغ الحجز: الحجوزات التي قُبض عليها عربون فعلاً
    supabase
      .from("reservations")
      .select("*, clients(name), units(project, unit_code)")
      .gt("amount", 0)
      .order("created_at", { ascending: false }),
  ]);

  const invoices = (inv ?? []) as Invoice[];
  const deposits = (res ?? []) as Reservation[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← لوحة التحكم
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">الفواتير</h1>
            <p className="text-sm text-gray-500">
              الفواتير ومبالغ الحجز — كلٌّ في بابه.
            </p>
          </div>
        </div>
        {admin ? (
          <Link
            href="/dashboard/invoices/new"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            + فاتورة جديدة
          </Link>
        ) : (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
            ما يخصّ عملاء مشروعك — للاطّلاع فقط
          </span>
        )}
      </header>

      <section className="p-6">
        {error ? (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            تعذّر جلب الفواتير: {error.message}
          </div>
        ) : (
          <MoneyTabs invoices={invoices} deposits={deposits} isAdmin={admin} />
        )}
      </section>
    </main>
  );
}
