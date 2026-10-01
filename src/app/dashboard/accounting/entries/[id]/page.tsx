import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/auth";
import { journalSourceLabel } from "@/lib/accounting";
import { JournalEntry, JournalLine, formatPrice } from "@/lib/types";
import DeleteEntryButton from "../delete-entry-button";
import ReverseEntryButton from "../reverse-entry-button";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// صفحة المصدر التي يُدار منها القيد الآلي — هناك يُحذف أو يُعكس أو يُعدَّل
async function sourceHref(supabase: Supabase, source: string, id: string): Promise<string | null> {
  switch (source) {
    case "cash_moves":
      return "/dashboard/accounting/moves";
    case "commissions":
      return "/dashboard/commissions";
    case "payrolls":
      return `/dashboard/hr/payroll/${id}`;
    case "payroll_payments": {
      const { data } = await supabase.from("payroll_payments").select("payroll_id").eq("id", id).maybeSingle();
      return data ? `/dashboard/hr/payroll/${data.payroll_id}` : null;
    }
    case "employee_advances":
      return "/dashboard/hr/payroll";
    case "external_debts":
    case "debt_repayments":
      return "/dashboard/accounting/debts";
    case "inventory_moves":
      return "/dashboard/inventory/moves";
    case "broker_payments":
      return "/dashboard/brokers/commissions";
    case "reservations":
      return `/dashboard/reservations/${id}`;
    case "sale_commissions": {
      const { data } = await supabase.from("sale_commissions").select("reservation_id").eq("id", id).maybeSingle();
      return data ? `/dashboard/reservations/${data.reservation_id}` : null;
    }
    default:
      return null;
  }
}

// تفاصيل قيد يومية: سطوره، ومن أين جاء، ومن كتبه، وما الذي يعكسه أو عكسه
export default async function EntryDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  if (!(await canManageFinance())) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("journal_entries")
    .select("*, journal_lines(*, accounts(code, name, type))")
    .eq("id", params.id)
    .single();

  if (!data) notFound();
  const entry = data as JournalEntry;
  const lines = entry.journal_lines ?? [];
  const isAuto = !!entry.source;

  const [{ data: authorProfile }, { data: authorEmployee }, { data: reversedBy }, href, { data: project }] = await Promise.all([
    entry.created_by
      ? supabase.from("profiles").select("email").eq("id", entry.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
    entry.created_by
      ? supabase.from("employees").select("full_name").eq("user_id", entry.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("journal_entries").select("id, entry_date").eq("reversal_of", entry.id).maybeSingle(),
    isAuto && entry.source_id ? sourceHref(supabase, entry.source!, entry.source_id) : Promise.resolve(null),
    entry.project_id
      ? supabase.from("projects").select("id, name").eq("id", entry.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const projectRow = project as { id: string; name: string } | null;

  const authorName =
    (authorEmployee as { full_name: string } | null)?.full_name ??
    (authorProfile as { email: string | null } | null)?.email ??
    null;

  const totalDebit = lines.reduce((s, l: JournalLine) => s + (l.debit ?? 0), 0);
  const totalCredit = lines.reduce((s, l: JournalLine) => s + (l.credit ?? 0), 0);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/accounting/entries"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← قيود اليومية
          </Link>
          <h1 className="text-xl font-bold text-brand-700">تفاصيل القيد</h1>
        </div>
        {/* القيد الآلي يُدار من مصدره؛ اليدوي يُعكس أو يُحذف هنا */}
        {!isAuto && (
          <div className="flex items-center gap-3">
            {!reversedBy && !entry.reversal_of && <ReverseEntryButton id={entry.id} />}
            {!reversedBy && <DeleteEntryButton id={entry.id} />}
          </div>
        )}
      </header>

      <section className="space-y-4 p-6">
        <div className="max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
          <div className="mb-4 flex flex-wrap justify-between gap-2 text-sm">
            <div>
              <span className="text-gray-500">البيان: </span>
              <span className="font-medium text-gray-800">{entry.description}</span>
            </div>
            <div dir="ltr">
              <span className="text-gray-500">التاريخ: </span>
              <span className="font-medium text-gray-800">{entry.entry_date}</span>
            </div>
          </div>

          <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl bg-gray-50 p-4 text-sm sm:grid-cols-5">
            <div>
              <dt className="text-xs text-gray-500">المصدر</dt>
              <dd className="font-medium text-gray-800">{journalSourceLabel(entry.source ?? null)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">المرجع</dt>
              <dd className="font-mono text-gray-800" dir="ltr">{entry.reference ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">المشروع</dt>
              <dd className="text-gray-800">
                {projectRow ? (
                  <Link href={`/dashboard/accounting/reports/projects/${projectRow.id}`} className="hover:text-brand-700 hover:underline">
                    {projectRow.name}
                  </Link>
                ) : (
                  "عام"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">الذراع</dt>
              <dd className="text-gray-800">{entry.arm ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">كتبه</dt>
              <dd className="text-gray-800">{authorName ?? (isAuto ? "النظام" : "—")}</dd>
            </div>
          </dl>

          {isAuto && (
            <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-gray-700">
              قيدٌ آلي كتبه النظام من {journalSourceLabel(entry.source ?? null)}. لا يُحذف ولا يُعدَّل من هنا —
              يُدار من مصدره، فيبقى المصدر وقيده متطابقين.
              {href ? (
                <Link href={href} className="ms-2 font-semibold text-brand-700 hover:underline">
                  افتح المصدر ←
                </Link>
              ) : (
                <span className="ms-2 font-semibold text-red-700">
                  لا مصدر لهذا القيد — راجع «صحّة المحاسبة».
                </span>
              )}
            </div>
          )}

          {entry.reversal_of && (
            <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              هذا قيدٌ عاكس.{" "}
              <Link href={`/dashboard/accounting/entries/${entry.reversal_of}`} className="font-semibold hover:underline">
                افتح القيد الأصلي ←
              </Link>
            </p>
          )}
          {reversedBy && (
            <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              عُكس هذا القيد في <span dir="ltr">{reversedBy.entry_date}</span>.{" "}
              <Link href={`/dashboard/accounting/entries/${reversedBy.id}`} className="font-semibold hover:underline">
                افتح القيد العاكس ←
              </Link>
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2 font-medium">الحساب</th>
                  <th className="px-4 py-2 font-medium">مدين</th>
                  <th className="px-4 py-2 font-medium">دائن</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l: JournalLine) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 text-gray-800">
                      <Link
                        href={`/dashboard/accounting/ledger/${l.accounts?.code}`}
                        className="hover:text-brand-700 hover:underline"
                      >
                        <span className="font-mono text-gray-400" dir="ltr">
                          {l.accounts?.code}
                        </span>{" "}
                        — {l.accounts?.name}
                      </Link>
                      {l.line_note && <span className="block text-xs text-gray-500">{l.line_note}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-end" dir="ltr">
                      {l.debit ? formatPrice(l.debit) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-end" dir="ltr">
                      {l.credit ? formatPrice(l.credit) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold text-gray-700">
                  <td className="px-4 py-2.5">الإجمالي</td>
                  <td className="px-4 py-2.5 text-end" dir="ltr">
                    {formatPrice(totalDebit)}
                  </td>
                  <td className="px-4 py-2.5 text-end" dir="ltr">
                    {formatPrice(totalCredit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
