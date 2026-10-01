import Link from "next/link";
import { redirect } from "next/navigation";
import { isBroker } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyBrokerUnits } from "@/lib/brokers";
import { Client } from "@/lib/types";
import UnitsBrowser from "./units-browser";

// ============================================================
// «الوحدات» — ما تعرضه تلال للشركة الوسيطة لتبيعه (sql/117).
//
// تأتي من الدالّة broker_units() لا من جدول الوحدات: الوسيط يرى ما
// يحتاجه للبيع (الموقع والمساحة والسعر وخطة الدفع) ولا يرى ملاحظات
// تلال الداخلية. والإدارة تقرّر لكل مشروع: كل المتاح أو وحدات مختارة.
// ============================================================
export default async function BrokerUnitsPage() {
  if (!(await isBroker())) redirect("/dashboard");

  const supabase = await createClient();
  const [units, { data: leadRows }] = await Promise.all([
    getMyBrokerUnits(),
    supabase
      .from("clients")
      .select("id, name, phone, project_id, stage")
      .not("broker_company_id", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  const leads = ((leadRows ?? []) as Pick<Client, "id" | "name" | "phone" | "project_id" | "stage">[])
    .filter((l) => l.stage !== "بيع");

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحتنا
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">الوحدات المتاحة لنا</h1>
            <p className="text-sm text-gray-500">
              اختر وحدة وارفع طلب حجز لعميلك — يتابعه مدير العلاقات المسؤول.
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/broker/requests"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
        >
          طلباتنا
        </Link>
      </header>

      <section className="p-6">
        {units.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا وحدات معروضة لكم الآن. حين تُسنِد تلال لكم مشروعاً أو تختار لكم
            وحدات تظهر هنا.
          </div>
        ) : (
          <UnitsBrowser units={units} leads={leads} />
        )}
      </section>
    </main>
  );
}
