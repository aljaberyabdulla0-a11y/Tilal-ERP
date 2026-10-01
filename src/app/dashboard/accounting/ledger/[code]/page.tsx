import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/auth";
import { journalSourceLabel } from "@/lib/accounting";
import { formatPrice } from "@/lib/types";
import PeriodFilter, { periodLabel, readPeriod } from "../../reports/period-filter";

type LedgerLine = {
  line_id: string;
  entry_id: string;
  entry_date: string;
  description: string;
  reference: string | null;
  source: string | null;
  arm: string | null;
  line_note: string | null;
  debit: number;
  credit: number;
  running: number;
  created_by_name: string | null;
};

const PAGE = 500;

// كشف حساب: كل سطر على الحساب في الفترة، بقيده ومصدره ورصيدٍ جارٍ
// يبدأ من الافتتاحي (account_ledger — sql/112). الطريق من رقم الميزان
// إلى القيد ثم إلى مصدره.
export default async function AccountLedgerPage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams?: { from?: string; to?: string; page?: string };
}) {
  if (!(await canManageFinance())) redirect("/dashboard");

  const period = readPeriod(searchParams);
  const page = Math.max(Number(searchParams?.page) || 0, 0);
  const supabase = await createClient();

  const { data: account } = await supabase
    .from("accounts")
    .select("code, name, type")
    .eq("code", params.code)
    .maybeSingle();
  if (!account) notFound();

  const { data, error } = await supabase.rpc("account_ledger", {
    p_code: params.code,
    p_from: period.from ?? null,
    p_to: period.to ?? null,
    p_limit: PAGE,
    p_offset: page * PAGE,
  });
  const lines = (data ?? []) as LedgerLine[];
  // الأصول والمصروفات رصيدها الطبيعي مدين؛ غيرها دائن — نعرض الرصيد بإشارته الطبيعية
  const natural = account.type === "asset" || account.type === "expense" ? 1 : -1;

  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (period.from) q.set("from", period.from);
    if (period.to) q.set("to", period.to);
    if (p > 0) q.set("page", String(p));
    const s = q.toString();
    return `/dashboard/accounting/ledger/${params.code}${s ? `?${s}` : ""}`;
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href={`/dashboard/accounting/reports/trial-balance`}
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← ميزان المراجعة
        </Link>
        <h1 className="text-xl font-bold text-brand-700">
          كشف حساب <span dir="ltr">{account.code}</span> — {account.name}
        </h1>
        <span className="text-sm text-gray-500">{periodLabel(period)}</span>
      </header>

      <section className="space-y-4 p-6">
        <PeriodFilter basePath={`/dashboard/accounting/ledger/${params.code}`} period={period} />

        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">تعذّر جلب الكشف: {error.message}</div>
        )}

        {!error && lines.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا سطور على هذا الحساب في الفترة.
          </div>
        )}

        {lines.length > 0 && (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[820px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-3 font-medium">التاريخ</th>
                  <th className="px-3 py-3 font-medium">البيان</th>
                  <th className="px-3 py-3 font-medium">المصدر</th>
                  <th className="px-3 py-3 font-medium">مدين</th>
                  <th className="px-3 py-3 font-medium">دائن</th>
                  <th className="px-3 py-3 font-medium">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.line_id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-600" dir="ltr">{l.entry_date}</td>
                    <td className="px-3 py-2.5 text-gray-800">
                      <Link href={`/dashboard/accounting/entries/${l.entry_id}`} className="hover:text-brand-700 hover:underline">
                        {l.description}
                      </Link>
                      {(l.line_note || l.created_by_name) && (
                        <span className="block text-xs text-gray-400">
                          {[l.line_note, l.created_by_name].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">
                      {journalSourceLabel(l.source)}
                      {l.reference && <span className="ms-1 font-mono" dir="ltr">{l.reference}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-end" dir="ltr">{l.debit ? formatPrice(l.debit) : "—"}</td>
                    <td className="px-3 py-2.5 text-end" dir="ltr">{l.credit ? formatPrice(l.credit) : "—"}</td>
                    <td className="px-3 py-2.5 text-end font-medium" dir="ltr">
                      {formatPrice(natural * Number(l.running))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-3 text-sm">
          {page > 0 && (
            <Link href={pageHref(page - 1)} className="text-brand-700 hover:underline">← السابق</Link>
          )}
          {lines.length === PAGE && (
            <Link href={pageHref(page + 1)} className="text-brand-700 hover:underline">التالي →</Link>
          )}
        </div>
      </section>
    </main>
  );
}
