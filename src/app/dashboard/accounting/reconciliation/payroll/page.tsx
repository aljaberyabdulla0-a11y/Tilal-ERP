import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/auth";
import { formatPrice } from "@/lib/types";
import AccTabs from "../../acc-tabs";
import PeriodFilter, { periodLabel, readPeriod } from "../../reports/period-filter";

type Row = {
  side: "حركة" | "كشف";
  classification: string;
  reason: string;
  ref_id: string;
  ref_date: string;
  amount: number;
  label: string;
  paid_by: string | null;
  employee_id: string | null;
  employee_name: string | null;
  payroll_id: string | null;
  period: string | null;
  payroll_net: number | null;
  paid_via_payroll: number | null;
};

const TONE: Record<string, string> = {
  "مطابق": "bg-green-100 text-green-800",
  "تكرار محتمل": "bg-red-100 text-red-800",
  "يحتاج مراجعة": "bg-amber-100 text-amber-800",
  "أجر يومي": "bg-blue-100 text-blue-800",
  "غير مطابق": "bg-gray-100 text-gray-700",
};

const ORDER = ["تكرار محتمل", "يحتاج مراجعة", "غير مطابق", "أجر يومي", "مطابق"];

// ============================================================
// مطابقة الرواتب (payroll_reconciliation — sql/110)
//
// الراتب يُسجَّل مصروفاً مرّةً عند اعتماد كشفه (5100/2300) ويُدفع من
// الكشف (2300/النقد). حركة «رواتب وأجور» على 5100 مباشرة تسجّله مرّةً
// ثانية إن كان له كشف. هنا كل حركة 5100 وكل كشف معتمد بصنفه وسببه.
// للقراءة فقط: لا يحذف شيئاً ولا يغيّر رقماً — التصحيح قرارٌ بعد المراجعة.
// ============================================================
export default async function PayrollReconciliationPage({
  searchParams,
}: {
  searchParams?: { from?: string; to?: string };
}) {
  if (!(await canManageFinance())) redirect("/dashboard");

  const period = readPeriod(searchParams);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payroll_reconciliation", {
    p_from: period.from ?? null,
    p_to: period.to ?? null,
  });
  const rows = (data ?? []) as Row[];
  const moves = rows.filter((r) => r.side === "حركة");
  const payrolls = rows.filter((r) => r.side === "كشف");

  const summary = ORDER.map((c) => {
    const list = rows.filter((r) => r.classification === c);
    return { c, n: list.length, amount: list.reduce((s, r) => s + Number(r.amount), 0) };
  }).filter((s) => s.n > 0);

  const chip = (c: string) => (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE[c] ?? "bg-gray-100"}`}>{c}</span>
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold text-brand-700">مطابقة الرواتب</h1>
        <p className="text-sm text-gray-500">
          حركات «رواتب وأجور» (5100) مقابل كشوف الرواتب ودفعاتها — {periodLabel(period)}
        </p>
      </header>

      <AccTabs active="health" />

      <section className="space-y-5 p-6">
        <PeriodFilter basePath="/dashboard/accounting/reconciliation/payroll" period={period} />

        {error && <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error.message}</div>}

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-gray-700">
          <b className="text-blue-900">كيف تُقرأ:</b> «تكرار محتمل» = حركة لموظف له كشف معتمد يغطّي تاريخها —
          المصروف قد يكون مسجّلاً مرّتين. «يحتاج مراجعة» = موظف معروف لكن بلا كشف يغطّي الحركة، أو دُفعت قبل
          نهاية شهر الكشف (غالباً راتب الشهر السابق). «أجر يومي» = مصوّر أو أسبوعية — مكانه من الآن «أجور يومية
          ومستقلون» (5110). كشفٌ «غير مطابق» = معتمد لم تُسجَّل دفعته: إن دُفع فعلاً فسجّل الدفعة من الكشف — ومنها
          «دفعه شريك من حسابه».
        </div>

        <div className="flex flex-wrap gap-3">
          {summary.map((s) => (
            <div key={s.c} className="rounded-xl border bg-white px-4 py-3 shadow-sm">
              {chip(s.c)}
              <p className="mt-1 text-lg font-bold text-gray-800">{s.n}</p>
              <p className="text-xs text-gray-500" dir="ltr">{formatPrice(s.amount)}</p>
            </div>
          ))}
        </div>

        <h2 className="text-lg font-semibold text-gray-800">الكشوف المعتمدة ({payrolls.length})</h2>
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-start text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-3 font-medium">الموظف</th>
                <th className="px-3 py-3 font-medium">الشهر</th>
                <th className="px-3 py-3 font-medium">الصافي</th>
                <th className="px-3 py-3 font-medium">المدفوع عبر الكشف</th>
                <th className="px-3 py-3 font-medium">الصنف</th>
                <th className="px-3 py-3 font-medium">السبب</th>
              </tr>
            </thead>
            <tbody>
              {payrolls.map((r) => (
                <tr key={r.ref_id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2.5 text-gray-800">
                    <Link href={`/dashboard/hr/payroll/${r.payroll_id}`} className="hover:text-brand-700 hover:underline">
                      {r.employee_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5" dir="ltr">{r.period}</td>
                  <td className="px-3 py-2.5 text-end" dir="ltr">{formatPrice(Number(r.payroll_net))}</td>
                  <td className="px-3 py-2.5 text-end" dir="ltr">{formatPrice(Number(r.paid_via_payroll))}</td>
                  <td className="px-3 py-2.5">{chip(r.classification)}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="text-lg font-semibold text-gray-800">حركات 5100 ({moves.length})</h2>
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-start text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-3 font-medium">التاريخ</th>
                <th className="px-3 py-3 font-medium">البيان</th>
                <th className="px-3 py-3 font-medium">المبلغ</th>
                <th className="px-3 py-3 font-medium">دفعها</th>
                <th className="px-3 py-3 font-medium">الموظف</th>
                <th className="px-3 py-3 font-medium">الصنف</th>
                <th className="px-3 py-3 font-medium">السبب</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((r) => (
                <tr key={r.ref_id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2.5 text-gray-600" dir="ltr">{r.ref_date}</td>
                  <td className="px-3 py-2.5 text-gray-800">{r.label}</td>
                  <td className="px-3 py-2.5 text-end" dir="ltr">{formatPrice(Number(r.amount))}</td>
                  <td className="px-3 py-2.5 text-gray-600">{r.paid_by}</td>
                  <td className="px-3 py-2.5 text-gray-800">
                    {r.employee_name ?? "—"}
                    {r.period && <span className="block text-xs text-gray-400" dir="ltr">كشف {r.period}</span>}
                  </td>
                  <td className="px-3 py-2.5">{chip(r.classification)}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
