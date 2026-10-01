import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/auth";
import { journalSourceLabel } from "@/lib/accounting";
import { formatPrice } from "@/lib/types";
import PeriodFilter, { periodLabel, readPeriod } from "../../period-filter";

type Line = {
  entry_id: string;
  entry_date: string;
  description: string;
  reference: string | null;
  source: string | null;
  account_code: string;
  account_name: string;
  account_type: "revenue" | "expense";
  amount: number;
};

// حساب مشروع واحد — أو «عام» (/projects/general): إيراده ومصروفه حسب الحساب،
// ثم كل سطر بقيده (project_ledger — sql/116).
export default async function ProjectFinanceDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { from?: string; to?: string };
}) {
  if (!(await canManageFinance())) redirect("/dashboard");

  const period = readPeriod(searchParams);
  const general = params.id === "general";
  const supabase = await createClient();

  let name = "عام — على الشركة";
  if (!general) {
    const { data: project } = await supabase.from("projects").select("name").eq("id", params.id).maybeSingle();
    if (!project) notFound();
    name = project.name;
  }

  const { data, error } = await supabase.rpc("project_ledger", {
    p_project: general ? null : params.id,
    p_from: period.from ?? null,
    p_to: period.to ?? null,
  });
  const lines = ((data ?? []) as Line[]).map((l) => ({ ...l, amount: Number(l.amount) }));

  // تجميع حسب الحساب
  const byAccount = new Map<string, { code: string; name: string; type: string; amount: number }>();
  lines.forEach((l) => {
    const cur = byAccount.get(l.account_code) ?? { code: l.account_code, name: l.account_name, type: l.account_type, amount: 0 };
    cur.amount += l.amount;
    byAccount.set(l.account_code, cur);
  });
  const accounts = Array.from(byAccount.values()).sort((a, b) => a.code.localeCompare(b.code));
  const revenue = accounts.filter((a) => a.type === "revenue").reduce((s, a) => s + a.amount, 0);
  const expense = accounts.filter((a) => a.type === "expense").reduce((s, a) => s + a.amount, 0);

  const base = `/dashboard/accounting/reports/projects/${params.id}`;
  const q = new URLSearchParams();
  if (period.from) q.set("from", period.from);
  if (period.to) q.set("to", period.to);
  const qs = q.toString() ? `?${q.toString()}` : "";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href={`/dashboard/accounting/reports/projects${qs}`} className="text-sm text-gray-500 hover:text-brand-700">
          ← حسابات المشاريع
        </Link>
        <h1 className="text-xl font-bold text-brand-700">{name}</h1>
        <span className="text-sm text-gray-500">{periodLabel(period)}</span>
      </header>

      <section className="space-y-5 p-6">
        <PeriodFilter basePath={base} period={period} />

        {error && <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error.message}</div>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="glass-card p-5">
            <span className="text-sm text-gray-500">الإيراد</span>
            <p className="mt-1 text-2xl font-bold text-green-700" dir="ltr">{formatPrice(revenue)}</p>
          </div>
          <div className="glass-card p-5">
            <span className="text-sm text-gray-500">الصرفيات</span>
            <p className="mt-1 text-2xl font-bold text-red-700" dir="ltr">{formatPrice(expense)}</p>
          </div>
          <div className="glass-card p-5">
            <span className="text-sm text-gray-500">الصافي</span>
            <p className={`mt-1 text-2xl font-bold ${revenue - expense >= 0 ? "text-green-700" : "text-red-700"}`} dir="ltr">
              {formatPrice(revenue - expense)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="rounded-lg border bg-white shadow-sm lg:col-span-1">
            <div className="border-b bg-gray-50 px-4 py-2 font-semibold text-gray-700">حسب الحساب</div>
            <table className="w-full text-start text-sm">
              <tbody>
                {accounts.length === 0 && (
                  <tr><td className="px-4 py-3 text-gray-400">لا حركة في الفترة</td></tr>
                )}
                {accounts.map((a) => (
                  <tr key={a.code} className="border-b last:border-0">
                    <td className="px-4 py-2.5 text-gray-800">
                      <span className="font-mono text-gray-400" dir="ltr">{a.code}</span> — {a.name}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-end font-medium ${a.type === "revenue" ? "text-green-700" : "text-red-700"}`}
                      dir="ltr"
                    >
                      {formatPrice(a.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm lg:col-span-2">
            <div className="border-b bg-gray-50 px-4 py-2 font-semibold text-gray-700">القيود ({lines.length})</div>
            <table className="w-full min-w-[560px] text-start text-sm">
              <tbody>
                {lines.map((l, i) => (
                  <tr key={`${l.entry_id}-${l.account_code}-${i}`} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-500" dir="ltr">{l.entry_date}</td>
                    <td className="px-3 py-2.5 text-gray-800">
                      <Link href={`/dashboard/accounting/entries/${l.entry_id}`} className="hover:text-brand-700 hover:underline">
                        {l.description}
                      </Link>
                      <span className="block text-xs text-gray-400">
                        {journalSourceLabel(l.source)} · {l.account_name}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-2.5 text-end font-medium ${l.account_type === "revenue" ? "text-green-700" : "text-red-700"}`}
                      dir="ltr"
                    >
                      {l.account_type === "revenue" ? "+" : "−"}
                      {formatPrice(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
