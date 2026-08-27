import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isBroker } from "@/lib/auth";
import { bucketLeads } from "@/lib/brokers";
import {
  Client,
  PIPELINE_STAGE_COLORS,
  leadDaysLeft,
  leadDeadlineColor,
  leadDeadlineLabel,
  sinceColor,
  sinceLabel,
  toIntlPhone,
} from "@/lib/types";

// ============================================================
// «ليداتنا» — شاشة الشركة الوسيطة.
//
// عمود المهلة هو عمود الشاشة الحقيقي: ما اقترب موعده أولاً. والترتيب
// من القاعدة (broker_deadline تصاعدياً) فالأعجل في الأعلى دائماً.
//
// لا فلترة بالشركة في الاستعلام: RLS تُرجع ليدات شركة صاحب الحساب
// وحدها (sql/043).
// ============================================================
export default async function BrokerLeadsPage() {
  if (!(await isBroker())) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("*, projects(name)")
    .order("broker_deadline", { ascending: true, nullsFirst: false });

  const leads = (data ?? []) as Client[];
  const buckets = bucketLeads(leads);
  const ordered = [
    ...buckets.expired,
    ...buckets.urgent,
    ...buckets.active,
    ...buckets.closed,
  ];

  const kpi = "glass-card border-s-4 p-5";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحتنا
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">ليداتنا</h1>
            <p className="text-sm text-gray-500">
              لكل ليد ٣٠ يوماً — أغلق البيع قبل انتهائها.
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/broker/leads/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + ليد جديد
        </Link>
      </header>

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className={kpi + " border-s-brand-500"}>
            <span className="text-sm text-gray-500">ليداتنا</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{leads.length}</p>
          </div>
          <div className={kpi + (buckets.urgent.length ? " border-s-red-500" : " border-s-emerald-500")}>
            <span className="text-sm text-gray-500">تحتاج إغلاقاً عاجلاً</span>
            <p className={`mt-1 text-2xl font-bold ${buckets.urgent.length ? "text-red-700" : "text-emerald-700"}`}>
              {buckets.urgent.length}
            </p>
          </div>
          <div className={kpi + " border-s-blue-500"}>
            <span className="text-sm text-gray-500">ضمن المهلة</span>
            <p className="mt-1 text-2xl font-bold text-blue-700">{buckets.active.length}</p>
          </div>
          <div className={kpi + " border-s-emerald-500"}>
            <span className="text-sm text-gray-500">أُغلقت بيعاً</span>
            <p className="mt-1 text-2xl font-bold text-emerald-700">{buckets.closed.length}</p>
          </div>
        </div>

        {ordered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا ليدات بعد.{" "}
            <Link
              href="/dashboard/broker/leads/new"
              className="font-semibold text-brand-700 underline"
            >
              أضف أول ليد
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">العميل</th>
                  <th className="px-4 py-3 text-start font-medium">الهاتف</th>
                  <th className="px-4 py-3 text-start font-medium">المشروع</th>
                  <th className="px-4 py-3 text-start font-medium">المرحلة</th>
                  <th className="px-4 py-3 text-start font-medium">المهلة</th>
                  <th className="px-4 py-3 text-start font-medium">آخر تواصل</th>
                  <th className="px-4 py-3 text-start font-medium">تواصل</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((l) => {
                  const closed = l.stage === "بيع";
                  const days = closed ? null : leadDaysLeft(l.broker_deadline);
                  const intl = l.phone ? toIntlPhone(l.phone) : "";
                  return (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/broker/leads/${l.id}`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          {l.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600" dir="ltr">
                        {l.phone ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {l.projects?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            PIPELINE_STAGE_COLORS[l.stage ?? "ليد"] ??
                            "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {l.stage ?? "ليد"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {closed ? (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            أُغلق بيعاً
                          </span>
                        ) : (
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-bold ${leadDeadlineColor(days)}`}
                          >
                            {leadDeadlineLabel(days)}
                          </span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-xs font-medium ${sinceColor(l.last_contact_at)}`}>
                        {sinceLabel(l.last_contact_at)}
                      </td>
                      <td className="px-4 py-3">
                        {intl ? (
                          <div className="flex gap-2">
                            <a
                              href={`tel:${intl}`}
                              className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                            >
                              اتصال
                            </a>
                            <a
                              href={`https://wa.me/${intl.replace("+", "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-lg bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 transition hover:bg-green-100"
                            >
                              واتساب
                            </a>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
