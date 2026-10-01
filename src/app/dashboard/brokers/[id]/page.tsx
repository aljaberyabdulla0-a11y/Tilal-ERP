import Link from "next/link";
import { getPipelineConfig } from "@/lib/crm-config";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canSeeBrokers, isAdmin } from "@/lib/auth";
import { getTeamMembers } from "@/lib/projects";
import {
  bucketLeads,
  commissionStatusOf,
  companyMoney,
  getBrokerCommissions,
  getBrokerLeads,
  getBrokerPayments,
  getBrokerRequests,
  getBrokerTiers,
  paidByCommission,
  unitsThisMonth,
} from "@/lib/brokers";
import {
  BrokerCompany,
  BrokerCompanyProject,
  BROKER_REQUEST_COLORS,
  BrokerUser,
  COMMISSION_STATUS_COLORS,
  currentPeriod,
  effectiveTiers,
  formatPrice,
  isOpenBrokerRequest,
  nextTier,
  tierRate,
  leadDaysLeft,
  leadDeadlineColor,
  leadDeadlineLabel,
} from "@/lib/types";
import CompanyAccounts from "./company-accounts";
import TiersEditor from "../tiers-editor";

// ============================================================
// بطاقة الشركة الوسيطة: مشاريعها وشرائحها ووحداتها الظاهرة، وطلبات
// حجزها، وليداتها ومهلها، وعمولاتها، وحساباتها.
// نفس الصفحة تخدم المدير ومدير العلاقات — والفرق أن أزرار الإدارة
// (التعديل وربط الحسابات) لا تظهر لغير المدير، تماماً كما تمنعها
// سياسات القاعدة.
// ============================================================
export default async function BrokerCompanyPage({
  params,
}: {
  params: { id: string };
}) {
  // المراحل وعتبات الصمت من القاعدة (sql/070) — أو ثوابت types.ts قبلها
  const crmCfg = await getPipelineConfig();
  if (!(await canSeeBrokers())) redirect("/dashboard");

  const supabase = await createClient();
  const [
    { data },
    { data: linkRows },
    { data: accountRows },
    leads,
    commissions,
    payments,
    members,
    admin,
    tiers,
    requests,
    { data: visibleRows },
  ] = await Promise.all([
    supabase.from("broker_companies").select("*").eq("id", params.id).maybeSingle(),
    supabase
      .from("broker_company_projects")
      .select("*, projects(name)")
      .eq("company_id", params.id),
    supabase.from("broker_users").select("*").eq("company_id", params.id),
    getBrokerLeads(params.id),
    getBrokerCommissions(params.id),
    getBrokerPayments(),
    getTeamMembers(),
    isAdmin(),
    getBrokerTiers(),
    getBrokerRequests(params.id),
    supabase.from("broker_visible_units").select("unit_id").eq("company_id", params.id),
  ]);

  if (!data) notFound();
  const company = data as BrokerCompany;
  const links = (linkRows ?? []) as BrokerCompanyProject[];
  const accounts = (accountRows ?? []) as BrokerUser[];
  const visibleCount = (visibleRows ?? []).length;

  const paid = paidByCommission(payments);
  const money = companyMoney(commissions, paid);
  const buckets = bucketLeads(leads);

  const period = currentPeriod();
  const monthUnits = unitsThisMonth(commissions, period);
  const openRequests = requests.filter((r) => isOpenBrokerRequest(r.status));

  const rmName = (id: string | null) =>
    members.find((m) => m.id === id)?.full_name ?? null;

  const kpi = "glass-card border-s-4 p-5";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/brokers" className="text-sm text-gray-500 hover:text-brand-700">
            ← الشركات الوسيطة
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">{company.name}</h1>
            <p className="text-sm text-gray-500">
              {company.is_active ? "شركة فعّالة" : "موقوفة"}
              {company.phone && ` · ${company.phone}`}
              {company.license_no && ` · إجازة ${company.license_no}`}
            </p>
          </div>
        </div>
        {admin && (
          <Link
            href={`/dashboard/brokers/${company.id}/edit`}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
          >
            تعديل
          </Link>
        )}
      </header>

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className={kpi + " border-s-blue-500"}>
            <span className="text-sm text-gray-500">ليدات لديها</span>
            <p className="mt-1 text-2xl font-bold text-blue-700">{leads.length}</p>
          </div>
          <div
            className={
              kpi +
              (buckets.urgent.length + buckets.expired.length
                ? " border-s-red-500"
                : " border-s-emerald-500")
            }
          >
            <span className="text-sm text-gray-500">مهل حرجة</span>
            <p className="mt-1 text-2xl font-bold text-red-700">
              {buckets.urgent.length + buckets.expired.length}
            </p>
          </div>
          <div className={kpi + " border-s-brand-500"}>
            <span className="text-sm text-gray-500">مستحق لها</span>
            <p className="mt-1 text-2xl font-bold text-gray-800" dir="ltr">
              {formatPrice(money.earned)}
            </p>
            <p className="mt-1 text-xs text-gray-400">{money.deals} صفقة</p>
          </div>
          <div className={kpi + (money.remaining ? " border-s-amber-500" : " border-s-emerald-500")}>
            <span className="text-sm text-gray-500">الباقي في ذمّتنا</span>
            <p
              className={`mt-1 text-2xl font-bold ${
                money.remaining ? "text-amber-700" : "text-emerald-700"
              }`}
              dir="ltr"
            >
              {formatPrice(money.remaining)}
            </p>
          </div>
        </div>

        {/* المشاريع ومدير العلاقات */}
        <div className="glass-card p-6">
          <h2 className="mb-3 text-lg font-bold text-gray-800">
            المشاريع ومدير العلاقات
          </h2>
          {links.length === 0 ? (
            <p className="text-sm text-amber-700">
              الشركة غير مُسنَدة لأي مشروع — لن تستطيع إدخال ليدات.
              {admin && (
                <>
                  {" "}
                  <Link
                    href={`/dashboard/brokers/${company.id}/edit`}
                    className="font-semibold underline"
                  >
                    أسندها الآن
                  </Link>
                </>
              )}
            </p>
          ) : (
            <div className="space-y-3">
              {links.map((l) => {
                const own = tiers.filter(
                  (t) => t.project_id === l.project_id && t.company_id === company.id
                );
                const eff = effectiveTiers(tiers, l.project_id, company.id);
                const n = monthUnits.get(`${company.id}|${l.project_id}`) ?? 0;
                const next = nextTier(eff, n);
                return (
                  <div key={l.project_id} className="rounded-xl bg-gray-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <b className="text-gray-800">{l.projects?.name ?? "—"}</b>
                        <span className="text-sm text-gray-500">
                          {" · "}
                          {rmName(l.rm_id) ?? "بلا مدير علاقات"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span className="rounded-full bg-white px-2.5 py-1 text-gray-600">
                          الوحدات: {l.units_scope === "الكل" ? "كل المتاح" : `مختارة (${visibleCount})`}
                        </span>
                        {admin && (
                          <Link
                            href={`/dashboard/brokers/${company.id}/units?project=${l.project_id}`}
                            className="font-semibold text-brand-700 hover:underline"
                          >
                            اختيار الوحدات
                          </Link>
                        )}
                      </div>
                    </div>

                    <p className="mt-2 text-sm text-gray-600">
                      هذا الشهر: <b>{n}</b> وحدة ← نسبتها الآن{" "}
                      <b>{tierRate(eff, n)}٪</b>
                      {next && (
                        <span className="text-gray-500">
                          {" "}· باقٍ {next.remaining} للشريحة {next.rate}٪
                        </span>
                      )}
                    </p>

                    <div className="mt-2">
                      <span className="me-2 text-xs font-bold text-gray-500">
                        {own.length ? "شرائح خاصة:" : "شرائح المشروع:"}
                      </span>
                      {own.length ? (
                        <TiersEditor
                          projectId={l.project_id}
                          companyId={company.id}
                          tiers={own}
                          canEdit={admin}
                        />
                      ) : (
                        <>
                          <TiersEditor
                            projectId={l.project_id}
                            companyId={null}
                            tiers={eff}
                            canEdit={false}
                            emptyHint="⚠️ لا شرائح لهذا المشروع — العمولة صفر"
                          />
                          {admin && (
                            <details className="mt-1 text-xs">
                              <summary className="cursor-pointer text-brand-700">
                                إعطاء الشركة شرائح خاصة في هذا المشروع
                              </summary>
                              <div className="mt-2">
                                <TiersEditor
                                  projectId={l.project_id}
                                  companyId={company.id}
                                  tiers={[]}
                                  canEdit
                                  emptyHint="تتبع شرائح المشروع"
                                />
                              </div>
                            </details>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* طلبات الحجز */}
        <div className="glass-card p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-gray-800">
              طلبات الحجز ({requests.length})
              {openRequests.length > 0 && (
                <span className="ms-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                  {openRequests.length} مفتوح
                </span>
              )}
            </h2>
            <Link
              href="/dashboard/brokers/requests"
              className="text-sm font-bold text-brand-700 hover:underline"
            >
              متابعة الطلبات
            </Link>
          </div>
          {requests.length === 0 ? (
            <p className="text-sm text-gray-400">لم ترفع الشركة طلب حجز بعد.</p>
          ) : (
            <div className="space-y-2">
              {requests.slice(0, 8).map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-4 py-2.5 text-sm"
                >
                  <span>
                    <b className="text-gray-800">الوحدة {r.unit_code ?? "—"}</b>
                    <span className="text-gray-500">
                      {" · "}
                      {r.clients?.name ?? "—"} · {r.projects?.name ?? ""}
                    </span>
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${BROKER_REQUEST_COLORS[r.status]}`}>
                    {r.status}
                    {r.reservation_status && r.reservation_status !== "حجز" ? ` · ${r.reservation_status}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* الليدات */}
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-6 py-4">
            <h2 className="text-lg font-bold text-gray-800">
              ليدات الشركة ({leads.length})
            </h2>
          </div>
          {leads.length === 0 ? (
            <p className="p-10 text-center text-gray-500">لا ليدات بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-start text-sm">
                <thead className="border-b bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3 text-start font-medium">العميل</th>
                    <th className="px-4 py-3 text-start font-medium">الهاتف</th>
                    <th className="px-4 py-3 text-start font-medium">المشروع</th>
                    <th className="px-4 py-3 text-start font-medium">المرحلة</th>
                    <th className="px-4 py-3 text-start font-medium">المهلة</th>
                    <th className="px-4 py-3 text-start font-medium">آخر تواصل</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => {
                    const days = l.stage === "بيع" ? null : leadDaysLeft(l.broker_deadline);
                    return (
                      <tr key={l.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <Link
                            href={`/dashboard/clients/${l.id}`}
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
                              crmCfg.colors[l.stage ?? "ليد"] ??
                              "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {l.stage ?? "ليد"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {l.stage === "بيع" ? (
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
                        <td className="px-4 py-3 text-gray-500">
                          {l.last_contact_at
                            ? new Date(l.last_contact_at).toLocaleDateString("ar")
                            : "لا يوجد"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* العمولات */}
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="text-lg font-bold text-gray-800">
              العمولات ({commissions.length})
            </h2>
            <Link
              href="/dashboard/brokers/commissions"
              className="text-sm font-bold text-brand-700 hover:underline"
            >
              كل العمولات وصرفها
            </Link>
          </div>
          {commissions.length === 0 ? (
            <p className="p-10 text-center text-gray-500">
              لا عمولات بعد — تُسجَّل تلقائياً عند إتمام بيع لأحد ليداتها.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-start text-sm">
                <thead className="border-b bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3 text-start font-medium">التاريخ</th>
                    <th className="px-4 py-3 text-start font-medium">العميل</th>
                    <th className="px-4 py-3 text-start font-medium">قيمة الصفقة</th>
                    <th className="px-4 py-3 text-start font-medium">النسبة</th>
                    <th className="px-4 py-3 text-start font-medium">العمولة</th>
                    <th className="px-4 py-3 text-start font-medium">المدفوع</th>
                    <th className="px-4 py-3 text-start font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => {
                    const status = commissionStatusOf(c, paid);
                    return (
                      <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600" dir="ltr">
                          {c.earned_at}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {c.clients?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600" dir="ltr">
                          {formatPrice(Number(c.deal_amount))}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {c.reversed_at ? (
                            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                              مفسوخة
                            </span>
                          ) : (
                            <>
                              <span dir="ltr">{c.rate}%</span>
                              {c.tier_units != null && (
                                <span className="ms-1 text-xs text-gray-400">
                                  ({c.tier_units} بالشهر)
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 font-bold text-gray-800" dir="ltr">
                          {formatPrice(Number(c.amount))}
                        </td>
                        <td className="px-4 py-3 text-emerald-700" dir="ltr">
                          {formatPrice(paid.get(c.id) ?? 0)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${COMMISSION_STATUS_COLORS[status]}`}
                          >
                            {status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* الحسابات — للمدير */}
        {admin && (
          <CompanyAccounts
            companyId={company.id}
            accounts={accounts}
          />
        )}
      </section>
    </main>
  );
}
