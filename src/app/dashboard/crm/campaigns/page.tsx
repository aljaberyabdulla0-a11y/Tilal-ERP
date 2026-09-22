import { redirect } from "next/navigation";
import Link from "next/link";
import { getUserRole } from "@/lib/auth";
import {
  getCampaigns,
  getCampaignPerformance,
  getSources,
  getProjectsLite,
  fmt,
} from "@/lib/crm";
import CrmTabs from "../crm-tabs";
import CampaignForm from "./campaign-form";

// ============================================================
// «الحملات» — القناة بكلفتها لا بعدد ليداتها (§29).
//
// حملةٌ تجيب ٣٠٠ ليد بمليونين وحملةٌ تجيب ٥٠ ليداً بمئتي ألف:
// الأولى أكبر والثانية أربح. ولا يُعرف ذلك إلا بعمود **المصروف**.
// ولذلك تبقى كلفة الليد والاستحواذ **فارغة** — لا صفراً — حتى
// يُملأ المصروف: الصفر يُقرأ «مجّاني»، والفراغ يُقرأ «لا نعرف».
//
// والإيراد هنا عمولة تلال لا ثمن الوحدة (sql/056) — فالعائد المعروض
// عائدٌ حقيقي على مصروف التسويق.
// ============================================================
export default async function CampaignsPage() {
  const role = await getUserRole();
  const READERS = ["admin", "followup_manager", "supervisor", "marketing", "viewer"];
  if (!READERS.includes(role)) {
    redirect("/dashboard/crm/today");
  }
  // التسويق يكتب الحملات ومصروفها — تطابق سياسة 084
  const canWrite = role === "admin" || role === "marketing";

  const [campaigns, perf, sources, projects] = await Promise.all([
    getCampaigns(),
    getCampaignPerformance(),
    getSources(),
    getProjectsLite(),
  ]);

  const perfById = new Map(perf.map((p) => [p.campaign_id, p]));
  const totalSpent = campaigns.reduce((s, c) => s + Number(c.spent ?? 0), 0);
  const totalLeads = perf.reduce((s, p) => s + Number(p.leads), 0);
  const totalWon = perf.reduce((s, p) => s + Number(p.won), 0);
  const totalRevenue = perf.reduce((s, p) => s + Number(p.revenue), 0);

  return (
    <div>
      <CrmTabs active="campaigns" />

      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-600">الحملات</h1>
            <p className="mt-1 text-sm text-gray-500">
              القناة بكلفتها وعائدها. والليد يُنسب إلى حملته من بوّابة الاستقبال أو بالإسناد اليدوي في ملفّه.
            </p>
          </div>
          <Link href="/dashboard/crm/reports#campaigns" className="text-sm text-brand-600 hover:underline">
            التفصيل في التقارير
          </Link>
        </header>

        {campaigns.length > 0 && (
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="المصروف" value={fmt(totalSpent)} />
            <Stat label="ليدات" value={fmt(totalLeads)} />
            <Stat label="بيع" value={fmt(totalWon)} tone="brand" />
            <Stat
              label="كلفة الاستحواذ"
              value={totalSpent > 0 && totalWon > 0 ? fmt(Math.round(totalSpent / totalWon)) : "—"}
              sub={totalSpent === 0 ? "املأ المصروف لتُحتسب" : `الإيراد ${fmt(totalRevenue)}`}
            />
          </section>
        )}

        {canWrite && <CampaignForm sources={sources} projects={projects} />}

        <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-right text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">الحملة</th>
                <th className="px-4 py-3 font-medium">المدة</th>
                <th className="px-4 py-3 font-medium">الميزانية / المصروف</th>
                <th className="px-4 py-3 font-medium">ليدات</th>
                <th className="px-4 py-3 font-medium">مؤهَّل</th>
                <th className="px-4 py-3 font-medium">بيع</th>
                <th className="px-4 py-3 font-medium">كلفة الليد</th>
                <th className="px-4 py-3 font-medium">الاستحواذ</th>
                <th className="px-4 py-3 font-medium">العائد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {campaigns.map((c) => {
                const p = perfById.get(c.id);
                return (
                  <tr key={c.id} className={c.is_active ? "" : "opacity-60"}>
                    <td className="px-4 py-2">
                      <p className="font-medium text-gray-800">{c.name}</p>
                      <p className="text-xs text-gray-400">{c.medium ?? "—"}{c.content ? ` · ${c.content}` : ""}</p>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500" dir="ltr">
                      {c.start_date ?? "—"}{c.end_date ? ` ← ${c.end_date}` : ""}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {fmt(c.budget)} / <b className={c.spent ? "text-gray-800" : "text-amber-700"}>{c.spent ? fmt(c.spent) : "لم يُملأ"}</b>
                    </td>
                    <td className="px-4 py-2">{fmt(p?.leads ?? 0)}</td>
                    <td className="px-4 py-2">{fmt(p?.qualified ?? 0)}</td>
                    <td className="px-4 py-2 font-semibold text-brand-700">{fmt(p?.won ?? 0)}</td>
                    <td className="px-4 py-2 text-gray-600">{p?.cost_per_lead != null ? fmt(p.cost_per_lead) : "—"}</td>
                    <td className="px-4 py-2 text-gray-600">{p?.cac != null ? fmt(p.cac) : "—"}</td>
                    <td className={`px-4 py-2 font-semibold ${p?.roi_pct == null ? "text-gray-400" : Number(p.roi_pct) >= 0 ? "text-brand-700" : "text-red-600"}`}>
                      {p?.roi_pct == null ? "—" : `${p.roi_pct}%`}
                    </td>
                  </tr>
                );
              })}
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">
                    لا حملات بعد. أضِف حملة بمصروفها لتظهر كلفة الليد وكلفة الاستحواذ والعائد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <p className="text-xs text-gray-500">
          «—» في أعمدة الكلفة تعني أن المصروف لم يُملأ — لا أن الكلفة صفر. والإيراد عمولة تلال وحدها لا ثمن الوحدة،
          فالعائد المعروض عائدٌ على مصروف التسويق حقيقةً.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "brand" }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className={`text-2xl font-bold ${tone === "brand" ? "text-brand-700" : "text-gray-800"}`}>{value}</p>
      <p className="text-sm text-gray-600">{label}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}
