import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/auth";
import { formatPrice } from "@/lib/types";
import AccTabs from "../../acc-tabs";
import PeriodFilter, { periodLabel, readPeriod } from "../period-filter";

export type ProjectFinanceRow = {
  project_id: string | null;
  project_name: string;
  revenue: number;
  payroll: number;
  commissions: number;
  brokers: number;
  marketing: number;
  other_expense: number;
  total_expense: number;
  net: number;
  entries: number;
};

// ============================================================
// حسابات المشاريع (project_finance — sql/116)
//
// من الدفتر نفسه: كل قيد يحمل مشروعه. الراتب على مشروع الموظف، والعمولة
// على مشروع الصفقة، والحركة على المشروع الذي اختاره من سجّلها. وما لا
// مشروع له يظهر في صفّ «عام — على الشركة» (مصاريف المكتب، الإدارة).
// ============================================================
export default async function ProjectsFinancePage({
  searchParams,
}: {
  searchParams?: { from?: string; to?: string };
}) {
  if (!(await canManageFinance())) redirect("/dashboard");

  const period = readPeriod(searchParams);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("project_finance", {
    p_from: period.from ?? null,
    p_to: period.to ?? null,
  });
  const rows = ((data ?? []) as ProjectFinanceRow[]).map((r) => ({
    ...r,
    revenue: Number(r.revenue),
    payroll: Number(r.payroll),
    commissions: Number(r.commissions),
    brokers: Number(r.brokers),
    marketing: Number(r.marketing),
    other_expense: Number(r.other_expense),
    total_expense: Number(r.total_expense),
    net: Number(r.net),
  }));

  const total = rows.reduce(
    (t, r) => ({
      revenue: t.revenue + r.revenue,
      payroll: t.payroll + r.payroll,
      commissions: t.commissions + r.commissions,
      brokers: t.brokers + r.brokers,
      marketing: t.marketing + r.marketing,
      other_expense: t.other_expense + r.other_expense,
      total_expense: t.total_expense + r.total_expense,
      net: t.net + r.net,
    }),
    { revenue: 0, payroll: 0, commissions: 0, brokers: 0, marketing: 0, other_expense: 0, total_expense: 0, net: 0 }
  );

  const q = new URLSearchParams();
  if (period.from) q.set("from", period.from);
  if (period.to) q.set("to", period.to);
  const qs = q.toString() ? `?${q.toString()}` : "";

  const money = (v: number) => (v ? formatPrice(v) : "—");

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold text-brand-700">حسابات المشاريع</h1>
        <p className="text-sm text-gray-500">
          إيراد كل مشروع وصرفياته من الدفاتر — {periodLabel(period)}
        </p>
      </header>

      <AccTabs active="projects" />

      <section className="space-y-5 p-6">
        <PeriodFilter basePath="/dashboard/accounting/reports/projects" period={period} />

        {error && <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error.message}</div>}

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-gray-700">
          <b className="text-blue-900">كيف يُحمَّل كل مبلغ على مشروعه:</b> الراتب على مشروع الموظف (ويُغيَّر من صفحة
          الكشف)، وعمولة الصفقة على مشروع الوحدة، والحركة المالية على المشروع الذي يُختار عند تسجيلها. الحركات
          القديمة تبقى «عامة» حتى تُنسب لمشروعها من{" "}
          <Link href="/dashboard/accounting/moves?project=general" className="font-semibold text-brand-700 hover:underline">
            صفحة الحركات
          </Link>
          .
        </div>

        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="w-full min-w-[920px] text-start text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-3 font-medium">المشروع</th>
                <th className="px-3 py-3 font-medium">الإيراد</th>
                <th className="px-3 py-3 font-medium">الرواتب والأجور</th>
                <th className="px-3 py-3 font-medium">عمولات الموظفين</th>
                <th className="px-3 py-3 font-medium">الوسطاء</th>
                <th className="px-3 py-3 font-medium">التسويق</th>
                <th className="px-3 py-3 font-medium">أخرى</th>
                <th className="px-3 py-3 font-medium">مجموع الصرف</th>
                <th className="px-3 py-3 font-medium">الصافي</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.project_id ?? "general"}
                  className={`border-b last:border-0 hover:bg-gray-50 ${r.project_id ? "" : "bg-gray-50/60"}`}
                >
                  <td className="px-3 py-2.5 font-medium text-gray-800">
                    <Link
                      href={`/dashboard/accounting/reports/projects/${r.project_id ?? "general"}${qs}`}
                      className="hover:text-brand-700 hover:underline"
                    >
                      {r.project_name}
                    </Link>
                    <span className="block text-xs text-gray-400">{r.entries} قيد</span>
                  </td>
                  <td className="px-3 py-2.5 text-end text-green-700" dir="ltr">{money(r.revenue)}</td>
                  <td className="px-3 py-2.5 text-end" dir="ltr">{money(r.payroll)}</td>
                  <td className="px-3 py-2.5 text-end" dir="ltr">{money(r.commissions)}</td>
                  <td className="px-3 py-2.5 text-end" dir="ltr">{money(r.brokers)}</td>
                  <td className="px-3 py-2.5 text-end" dir="ltr">{money(r.marketing)}</td>
                  <td className="px-3 py-2.5 text-end" dir="ltr">{money(r.other_expense)}</td>
                  <td className="px-3 py-2.5 text-end font-medium text-red-700" dir="ltr">{money(r.total_expense)}</td>
                  <td
                    className={`px-3 py-2.5 text-end font-bold ${r.net >= 0 ? "text-green-700" : "text-red-700"}`}
                    dir="ltr"
                  >
                    {formatPrice(r.net)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-bold text-gray-800">
                <td className="px-3 py-3">المجموع</td>
                <td className="px-3 py-3 text-end" dir="ltr">{formatPrice(total.revenue)}</td>
                <td className="px-3 py-3 text-end" dir="ltr">{formatPrice(total.payroll)}</td>
                <td className="px-3 py-3 text-end" dir="ltr">{formatPrice(total.commissions)}</td>
                <td className="px-3 py-3 text-end" dir="ltr">{formatPrice(total.brokers)}</td>
                <td className="px-3 py-3 text-end" dir="ltr">{formatPrice(total.marketing)}</td>
                <td className="px-3 py-3 text-end" dir="ltr">{formatPrice(total.other_expense)}</td>
                <td className="px-3 py-3 text-end" dir="ltr">{formatPrice(total.total_expense)}</td>
                <td className="px-3 py-3 text-end" dir="ltr">{formatPrice(total.net)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-gray-400">
          المجموع = قائمة الدخل للفترة نفسها. الرواتب تشمل الأجور اليومية (5100 + 5110).
        </p>
      </section>
    </main>
  );
}
