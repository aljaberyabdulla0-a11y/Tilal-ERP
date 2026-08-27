import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeBrokers, isAdmin } from "@/lib/auth";
import { getTeamMembers } from "@/lib/projects";
import {
  bucketLeads,
  companyMoney,
  getBrokerCommissions,
  getBrokerCompanies,
  getBrokerLeads,
  getBrokerPayments,
  getBrokerProjects,
  paidByCommission,
} from "@/lib/brokers";
import { formatPrice } from "@/lib/types";
import BrokersTabs from "./brokers-tabs";

// ============================================================
// الشركات الوسيطة — شاشة الماستر بروكر.
//
// لكل شركة سطر يجيب عن أربعة أسئلة دفعةً واحدة:
//   كم ليداً عندها الآن؟ · كم منها يوشك على انتهاء مهلته؟ ·
//   كم صفقة أغلقت؟ · وكم لها في ذمّتنا؟
//
// المدير يرى الجميع، ومدير العلاقات يرى شركاته هو — والفرق تفرضه
// سياسات القاعدة لا هذه الصفحة (sql/043).
// ============================================================
export default async function BrokersPage() {
  if (!(await canSeeBrokers())) redirect("/dashboard");

  const [companies, links, leads, commissions, payments, members, admin] =
    await Promise.all([
      getBrokerCompanies(),
      getBrokerProjects(),
      getBrokerLeads(),
      getBrokerCommissions(),
      getBrokerPayments(),
      getTeamMembers(),
      isAdmin(),
    ]);

  const paid = paidByCommission(payments);
  const rmName = (id: string | null) =>
    members.find((m) => m.id === id)?.full_name ?? null;

  const rows = companies.map((c) => {
    const myLeads = leads.filter((l) => l.broker_company_id === c.id);
    const buckets = bucketLeads(myLeads);
    const money = companyMoney(
      commissions.filter((x) => x.company_id === c.id),
      paid
    );
    const myLinks = links.filter((l) => l.company_id === c.id);
    return { company: c, buckets, money, links: myLinks, leads: myLeads.length };
  });

  const totals = {
    companies: companies.filter((c) => c.is_active).length,
    leads: leads.length,
    urgent: rows.reduce((s, r) => s + r.buckets.urgent.length + r.buckets.expired.length, 0),
    remaining: rows.reduce((s, r) => s + r.money.remaining, 0),
  };

  const kpi = "glass-card border-s-4 p-5";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">الشركات الوسيطة</h1>
            <p className="text-sm text-gray-500">
              شركات تُدخل ليداتها في مشاريعنا، ولها عمولة من كل بيع.
            </p>
          </div>
        </div>
        {admin && (
          <Link
            href="/dashboard/brokers/new"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            + شركة جديدة
          </Link>
        )}
      </header>

      <BrokersTabs active="companies" />

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className={kpi + " border-s-brand-500"}>
            <span className="text-sm text-gray-500">شركات فعّالة</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{totals.companies}</p>
          </div>
          <div className={kpi + " border-s-blue-500"}>
            <span className="text-sm text-gray-500">ليدات لديها الآن</span>
            <p className="mt-1 text-2xl font-bold text-blue-700">{totals.leads}</p>
          </div>
          <div className={kpi + (totals.urgent ? " border-s-red-500" : " border-s-emerald-500")}>
            <span className="text-sm text-gray-500">مهل توشك أو انتهت</span>
            <p className={`mt-1 text-2xl font-bold ${totals.urgent ? "text-red-700" : "text-emerald-700"}`}>
              {totals.urgent}
            </p>
          </div>
          <div className={kpi + " border-s-amber-500"}>
            <span className="text-sm text-gray-500">عمولات في ذمّتنا</span>
            <p className="mt-1 text-2xl font-bold text-amber-700" dir="ltr">
              {formatPrice(totals.remaining)}
            </p>
          </div>
        </div>

        {admin && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-gray-700">
            <b className="text-blue-800">كيف يعمل النموذج؟</b> تُنشئ الشركة وتحدّد
            نسبة عمولتها، وتُسندها لمشروع أو أكثر ولكل إسناد <b>مدير علاقات</b>
            يتابعها. ثم تربط حساب دخول بالشركة فتبدأ بإدخال ليداتها. لكل ليد{" "}
            <b>٣٠ يوماً</b>: إن لم يُغلق البيع خلالها عاد الليد إلى تلال تلقائياً
            لتوزّعه من{" "}
            <Link href="/dashboard/brokers/leads" className="font-semibold underline">
              صفحة الليدات
            </Link>
            . وعند إتمام أي بيع تُسجَّل عمولة الشركة تلقائياً.
          </div>
        )}

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            {admin
              ? "لا توجد شركات وسيطة بعد. أنشئ شركة، أسندها لمشروع، ثم اربط لها حساب دخول."
              : "لا توجد شركات تحت مظلتك بعد — راجع الإدارة لإسناد الشركات إليك."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full min-w-[1000px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">الشركة</th>
                  <th className="px-4 py-3 text-start font-medium">النسبة</th>
                  <th className="px-4 py-3 text-start font-medium">المشاريع ومدير العلاقات</th>
                  <th className="px-4 py-3 text-start font-medium">ليدات</th>
                  <th className="px-4 py-3 text-start font-medium">مهل حرجة</th>
                  <th className="px-4 py-3 text-start font-medium">صفقات</th>
                  <th className="px-4 py-3 text-start font-medium">مستحق لها</th>
                  <th className="px-4 py-3 text-start font-medium">باقٍ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.company.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/brokers/${r.company.id}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {r.company.name}
                      </Link>
                      {!r.company.is_active && (
                        <span className="ms-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                          موقوفة
                        </span>
                      )}
                      {r.company.phone && (
                        <span className="block text-xs text-gray-400" dir="ltr">
                          {r.company.phone}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-bold text-gray-800" dir="ltr">
                      {r.company.commission_rate}%
                    </td>
                    <td className="px-4 py-3">
                      {r.links.length === 0 ? (
                        <span className="text-xs text-amber-700">
                          لم تُسنَد لمشروع بعد
                        </span>
                      ) : (
                        <div className="space-y-1">
                          {r.links.map((l) => (
                            <div key={l.project_id} className="text-xs text-gray-600">
                              <b className="text-gray-800">{l.projects?.name ?? "—"}</b>
                              {" · "}
                              {rmName(l.rm_id) ?? (
                                <span className="text-amber-700">بلا مدير علاقات</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.leads}</td>
                    <td className="px-4 py-3">
                      {r.buckets.urgent.length + r.buckets.expired.length > 0 ? (
                        <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">
                          {r.buckets.urgent.length + r.buckets.expired.length}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.money.deals}</td>
                    <td className="px-4 py-3 text-gray-700" dir="ltr">
                      {formatPrice(r.money.earned)}
                    </td>
                    <td className="px-4 py-3 font-bold" dir="ltr">
                      <span className={r.money.remaining ? "text-amber-700" : "text-emerald-700"}>
                        {formatPrice(r.money.remaining)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
