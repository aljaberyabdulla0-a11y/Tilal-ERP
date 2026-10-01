import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeBrokers, isAdmin } from "@/lib/auth";
import { getProjects } from "@/lib/projects";
import { getBrokerCompanies, getBrokerProjects, getBrokerTiers } from "@/lib/brokers";
import { tiersLabel } from "@/lib/types";
import BrokersTabs from "../brokers-tabs";
import TiersEditor from "../tiers-editor";

// ============================================================
// شرائح عمولة الوسطاء لكل مشروع (sql/117).
//
// العمولة ليست نسبةً مقطوعة للشركة: كل مشروع له شرائح تصاعدية بعدد
// وحدات الشركة في الشهر، تسري على كل الوسطاء. والاستثناء — شركةٌ
// بشرائح خاصة — يُعرَّف من بطاقتها ويظهر هنا للعلم.
// ============================================================
export default async function BrokerTiersPage() {
  if (!(await canSeeBrokers())) redirect("/dashboard");

  const [projects, tiers, links, companies, admin] = await Promise.all([
    getProjects(),
    getBrokerTiers(),
    getBrokerProjects(),
    getBrokerCompanies(),
    isAdmin(),
  ]);

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? "شركة";

  // المشاريع التي فيها وسطاء أولاً — هي التي تحتاج شرائح الآن
  const withBrokers = new Set(links.map((l) => l.project_id));
  const ordered = [...projects].sort(
    (a, b) => Number(withBrokers.has(b.id)) - Number(withBrokers.has(a.id))
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">شرائح عمولة الوسطاء</h1>
      </header>

      <BrokersTabs active="tiers" />

      <section className="space-y-4 p-6">
        <div className="rounded-2xl bg-brand-50 p-4 text-sm text-brand-900">
          <b>كيف تُحسب:</b> تُعدّ وحدات كل شركة في المشروع خلال الشهر. حين
          تبلغ شريحةً تصير <b>كل صفقاتها في ذلك المشروع ذلك الشهر</b> بنسبة
          الشريحة (بأثر رجعي)، ويرى الوسيط الفرق مع كل صفقة. والعدّاد يبدأ من
          الصفر أول كل شهر.
        </div>

        {ordered.map((p) => {
          const projectTiers = tiers.filter((t) => t.project_id === p.id && t.company_id === null);
          const overrides = Array.from(
            new Set(
              tiers
                .filter((t) => t.project_id === p.id && t.company_id !== null)
                .map((t) => t.company_id as string)
            )
          );
          const assigned = links.filter((l) => l.project_id === p.id);

          return (
            <div key={p.id} className="glass-card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-gray-800">{p.name}</h2>
                <span className="text-xs text-gray-500">
                  {assigned.length
                    ? `${assigned.length} شركة مُسنَدة`
                    : "لا شركات مُسنَدة"}
                </span>
              </div>

              <TiersEditor
                projectId={p.id}
                companyId={null}
                tiers={projectTiers}
                canEdit={admin}
                emptyHint={
                  assigned.length
                    ? "⚠️ لا شرائح — عمولة الوسطاء في هذا المشروع صفر"
                    : "لا شرائح بعد"
                }
              />

              {overrides.length > 0 && (
                <div className="mt-3 space-y-1 border-t pt-3">
                  <p className="text-xs font-bold text-gray-500">شرائح خاصة:</p>
                  {overrides.map((cid) => (
                    <p key={cid} className="text-sm">
                      <Link
                        href={`/dashboard/brokers/${cid}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {companyName(cid)}
                      </Link>
                      <span className="ms-2 text-gray-600">
                        {tiersLabel(
                          tiers
                            .filter((t) => t.project_id === p.id && t.company_id === cid)
                            .sort((a, b) => a.min_units - b.min_units)
                        )}
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
