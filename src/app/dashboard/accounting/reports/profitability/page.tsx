import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { formatPrice } from "@/lib/types";
import AccTabs from "../../acc-tabs";

type ProjectRow = {
  project_id: string;
  project_name: string;
  deals: number;
  company_commission: number;
  collected: number;
  employee_commission: number;
  broker_commission: number;
  salaries: number;
  cost: number;
  profit: number;
};

type AgingRow = {
  reservation_id: string;
  project_name: string | null;
  unit_code: string | null;
  client_name: string | null;
  amount: number;
  accrued_on: string;
  age_days: number;
  bucket: string;
};

const BUCKET_COLORS: Record<string, string> = {
  "حتى ٣٠ يوماً": "bg-green-100 text-green-700",
  "٣١–٦٠": "bg-blue-100 text-blue-700",
  "٦١–٩٠": "bg-amber-100 text-amber-700",
  "أكثر من ٩٠": "bg-red-100 text-red-700",
};

// ============================================================
// ربحية المشاريع وأعمار عمولاتنا (sql/066).
//
// ⚠️ «أعمار الذمم» هنا ليست فواتير المشترين: تلال وسيط، وفاتورة
// المشتري ليست ذمّةً لها. الذمّة الحقيقية الوحيدة هي **عمولاتنا
// عند المطوّرين** — حساب 1250.
// ============================================================
export default async function ProfitabilityPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: pData }, { data: aData }] = await Promise.all([
    supabase.rpc("project_profitability", { p_from: null, p_to: null }),
    supabase.rpc("commission_receivable_aging"),
  ]);

  const projects = (pData ?? []) as ProjectRow[];
  const aging = (aData ?? []) as AgingRow[];

  const shown = projects.filter((p) => p.deals > 0 || p.cost > 0);
  const totalDue = aging.reduce((s, a) => s + Number(a.amount), 0);
  const overdue = aging
    .filter((a) => a.age_days > 60)
    .reduce((s, a) => s + Number(a.amount), 0);

  const kpi = "glass-card border-s-4 p-5";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/finance" className="text-sm text-gray-500 hover:text-brand-700">
          ← المالية
        </Link>
        <div>
          <h1 className="text-xl font-bold text-brand-700">ربحية المشاريع</h1>
          <p className="text-sm text-gray-500">
            عمولتنا من كل مشروع، وما يكلّفنا، وما لنا عند المطوّرين.
          </p>
        </div>
      </header>

      <AccTabs active="profit" />

      <section className="space-y-5 p-6">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-gray-700">
          <b className="text-blue-800">إيرادنا هو العمولة لا ثمن الوحدة.</b> فربحية
          المشروع = عمولة تلال عن صفقاته، ناقص عمولات موظفيها عليها ورواتب
          المُسنَدين إليه وعمولات الشركات الوسيطة. والصفقات المفسوخة خارج
          الحساب — لم تكن إيراداً قط.
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className={kpi + " border-s-brand-500"}>
            <span className="text-sm text-gray-500">لنا عند المطوّرين</span>
            <p className="mt-1 text-2xl font-bold text-brand-700" dir="ltr">
              {formatPrice(totalDue)}
            </p>
          </div>
          <div className={kpi + (overdue > 0 ? " border-s-red-500" : " border-s-gray-300")}>
            <span className="text-sm text-gray-500">متأخّر أكثر من ٦٠ يوماً</span>
            <p
              className={`mt-1 text-2xl font-bold ${overdue > 0 ? "text-red-700" : "text-gray-500"}`}
              dir="ltr"
            >
              {formatPrice(overdue)}
            </p>
          </div>
          <div className={kpi + " border-s-blue-500"}>
            <span className="text-sm text-gray-500">صفقات هذه السنة</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">
              {projects.reduce((s, p) => s + p.deals, 0)}
            </p>
          </div>
        </div>

        {/* الربحية */}
        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <table className="w-full min-w-[820px] text-start text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">المشروع</th>
                <th className="px-4 py-3 font-medium">صفقات</th>
                <th className="px-4 py-3 font-medium">عمولتنا</th>
                <th className="px-4 py-3 font-medium">منها محصّل</th>
                <th className="px-4 py-3 font-medium">عمولات الموظفين</th>
                <th className="px-4 py-3 font-medium">وسطاء</th>
                <th className="px-4 py-3 font-medium">رواتب</th>
                <th className="px-4 py-3 font-medium">الربح</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    لا صفقات مؤكَّدة المقدمة هذه السنة بعد.
                  </td>
                </tr>
              ) : (
                shown.map((p) => (
                  <tr key={p.project_id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{p.project_name}</td>
                    <td className="px-4 py-3 text-gray-600">{p.deals}</td>
                    <td className="px-4 py-3 font-medium text-brand-700" dir="ltr">
                      {formatPrice(p.company_commission)}
                    </td>
                    <td className="px-4 py-3 text-green-700" dir="ltr">
                      {formatPrice(p.collected)}
                    </td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">
                      {formatPrice(p.employee_commission)}
                    </td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">
                      {formatPrice(p.broker_commission)}
                    </td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">
                      {formatPrice(p.salaries)}
                    </td>
                    <td
                      className={`px-4 py-3 font-bold ${
                        p.profit >= 0 ? "text-green-700" : "text-red-700"
                      }`}
                      dir="ltr"
                    >
                      {formatPrice(p.profit)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* أعمار العمولات */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h3 className="mb-1 font-semibold text-gray-800">
            أعمار عمولاتنا عند المطوّرين
          </h3>
          <p className="mb-3 text-xs text-gray-400">
            كل صفقة أُكّدت مقدّمتها ولم تُحصَّل عمولتها بعد — وهي الذمّة
            الحقيقية الوحيدة لتلال (حساب 1250).
          </p>
          {aging.length === 0 ? (
            <p className="text-sm text-gray-400">لا ذمم — كل ما استُحقّ حُصّل.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {aging.map((a) => (
                <div key={a.reservation_id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-800">
                      {a.project_name ?? "—"} · وحدة {a.unit_code ?? "—"}
                    </span>
                    <span className="block truncate text-[11px] text-gray-400">
                      {a.client_name ?? "—"} · استُحقّت{" "}
                      <span dir="ltr">{a.accrued_on}</span>
                    </span>
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      BUCKET_COLORS[a.bucket] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {a.bucket} ({a.age_days} يوم)
                  </span>
                  <span className="shrink-0 font-semibold text-brand-700" dir="ltr">
                    {formatPrice(a.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
