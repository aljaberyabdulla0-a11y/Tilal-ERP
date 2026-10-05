import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeBrokers, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProjects } from "@/lib/projects";
import { getUnitTypes } from "@/lib/estate";
import { getBrokerCompanies, getBrokerProjects, getCommissionPlans } from "@/lib/brokers";
import { PLAN_RECIPIENT_TYPES, PlanRecipientType, effectivePlan, planTiersLabel } from "@/lib/types";
import BrokersTabs from "../brokers-tabs";
import PlanEditor from "../plan-editor";
import RequestTtl from "./request-ttl";

// ============================================================
// خطط العمولة لكل مشروع (sql/129) — ثلاث طبقات لا تختلط:
//   • وسيط: ما تدفعه تلال للشركة الوسيطة عن صفقاتها.
//   • موظف مباشر: ما يستحقّه بائع تلال في البيع المباشر.
//   • مدير علاقات: عمولة داخلية للـRM على صفقات شركاته — مستقلّة عن
//     عمولة الوسيط ولا تُخصم منها.
// (وعمولة تلال من المطوّر طبقةٌ رابعة في «العمولات» — 048.)
//
// بلا خطة «موظف مباشر» تبقى قواعد 048 القديمة نافذة؛ وبلا خطة «مدير
// علاقات» لا عمولة للـRM على صفقة الوسيط.
// ============================================================
const TYPE_HINTS: Record<PlanRecipientType, { empty: string; note: string }> = {
  "وسيط": {
    empty: "⚠️ لا خطة — عمولة الوسطاء في هذا المشروع صفر",
    note: "العدّاد لكل شركة على حدة في المشروع والفترة",
  },
  "موظف مباشر": {
    empty: "لا خطة — تُطبَّق قواعد عمولة الموظفين العامة (العمولات ← القواعد)",
    note: "لكل موظف عدّاده من مبيعاته المباشرة وحدها",
  },
  "مدير علاقات": {
    empty: "لا خطة — لا عمولة داخلية للـRM على صفقات الوسطاء",
    note: "لكل RM عدّاده من صفقات شركاته — لا تُخصم من عمولة الوسيط",
  },
};

export default async function CommissionPlansPage() {
  if (!(await canSeeBrokers())) redirect("/dashboard");

  const supabase = await createClient();
  const [projects, plans, links, companies, admin, unitTypeRows, { data: settingsRows }] = await Promise.all([
    getProjects(),
    getCommissionPlans(),
    getBrokerProjects(),
    getBrokerCompanies(),
    isAdmin(),
    getUnitTypes(),
    supabase.from("project_broker_settings").select("project_id, request_ttl_hours"),
  ]);
  const unitTypes = unitTypeRows.map((u) => u.name);
  const ttl = new Map((settingsRows ?? []).map((s) => [s.project_id as string, s.request_ttl_hours as number | null]));

  const companyName = (id: string | null) => companies.find((c) => c.id === id)?.name ?? "شركة";
  const withBrokers = new Set(links.map((l) => l.project_id));
  const ordered = [...projects].sort((a, b) => Number(withBrokers.has(b.id)) - Number(withBrokers.has(a.id)));

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">خطط العمولة</h1>
      </header>

      <BrokersTabs active="plans" />

      <section className="space-y-4 p-6">
        <div className="rounded-2xl bg-brand-50 p-4 text-sm text-brand-900">
          <b>كيف تُحسب:</b> لكل خطة <b>صيغة</b> (رجعية: بلوغ شريحة يرفع كل صفقات الفترة · حدّية: كل
          صفقة بنسبة ترتيبها · ثابتة) و<b>أساس</b> (عدد الوحدات أو قيمة المبيعات) و<b>فترة</b> يُصفَّر
          العدّاد بعدها. والشريحة نسبةٌ من سعر الصفقة و/أو مبلغ ثابت، ويجوز قصرها على نوع وحدة. كل
          تغيير على عمولة مستحقّة يُسجَّل سطرَ تعديل ولا يُمحى.
        </div>

        {ordered.map((p) => {
          const overrides = plans.filter((x) => x.is_active && x.project_id === p.id && x.company_id);
          const empOverrides = plans.filter((x) => x.is_active && x.project_id === p.id && x.employee_id);
          const inactive = plans.filter((x) => !x.is_active && x.project_id === p.id);
          const assigned = links.filter((l) => l.project_id === p.id).length;
          return (
            <div key={p.id} className="glass-card space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-gray-800">{p.name}</h2>
                <span className="text-xs text-gray-500">
                  {assigned ? `${assigned} شركة مُسنَدة` : "لا شركات مُسنَدة"}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                {PLAN_RECIPIENT_TYPES.map((type) => {
                  const plan = effectivePlan(plans, p.id, type);
                  return (
                    <div key={type} className="rounded-xl bg-gray-50 p-4">
                      <h3 className="font-bold text-gray-800">{type}</h3>
                      <p className="mb-2 text-[11px] text-gray-500">{TYPE_HINTS[type].note}</p>
                      <PlanEditor
                        key={plan?.id ?? `new-${type}`}
                        projectId={p.id}
                        recipientType={type}
                        plan={plan}
                        unitTypes={unitTypes}
                        canEdit={admin}
                        emptyHint={TYPE_HINTS[type].empty}
                      />
                    </div>
                  );
                })}
              </div>

              {overrides.length > 0 && (
                <div className="space-y-1 border-t pt-3">
                  <p className="text-xs font-bold text-gray-500">خطط خاصة لشركات (تحلّ محلّ خطة المشروع كلّها):</p>
                  {overrides.map((o) => (
                    <p key={o.id} className="text-sm">
                      <Link href={`/dashboard/brokers/${o.company_id}`} className="font-semibold text-brand-700 hover:underline">
                        {companyName(o.company_id)}
                      </Link>
                      <span className="ms-2 text-gray-600">
                        {o.formula} · {o.basis} · {o.period} — {planTiersLabel(o, o.commission_plan_tiers ?? [])}
                      </span>
                    </p>
                  ))}
                </div>
              )}
              {empOverrides.length > 0 && (
                <p className="text-xs text-gray-500">+ {empOverrides.length} خطة خاصة لموظفين</p>
              )}
              {inactive.length > 0 && (
                <details className="text-xs text-gray-500">
                  <summary className="cursor-pointer">خطط سابقة ({inactive.length}) — باقية لعمولاتها</summary>
                  <ul className="mt-1 space-y-1">
                    {inactive.map((o) => (
                      <li key={o.id}>
                        {o.recipient_type}
                        {o.company_id ? ` · ${companyName(o.company_id)}` : ""} · {o.formula} ·{" "}
                        {planTiersLabel(o, o.commission_plan_tiers ?? [])} · حتى {o.updated_at.slice(0, 10)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {admin && assigned > 0 && (
                <div className="border-t pt-3">
                  <RequestTtl projectId={p.id} hours={ttl.has(p.id) ? ttl.get(p.id) ?? null : 72} />
                </div>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
