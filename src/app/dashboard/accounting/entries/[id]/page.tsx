import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { JournalEntry, JournalLine, formatPrice } from "@/lib/types";
import DeleteEntryButton from "../delete-entry-button";

// تفاصيل قيد يومية مع سطوره
export default async function EntryDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("journal_entries")
    .select("*, journal_lines(*, accounts(code, name, type))")
    .eq("id", params.id)
    .single();

  if (!data) notFound();
  const entry = data as JournalEntry;
  const lines = entry.journal_lines ?? [];

  const totalDebit = lines.reduce((s, l: JournalLine) => s + (l.debit ?? 0), 0);
  const totalCredit = lines.reduce((s, l: JournalLine) => s + (l.credit ?? 0), 0);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/accounting/entries"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← قيود اليومية
          </Link>
          <h1 className="text-xl font-bold text-brand-700">تفاصيل القيد</h1>
        </div>
        <DeleteEntryButton id={entry.id} />
      </header>

      <section className="p-6">
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

          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-right text-sm">
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
                      <span className="font-mono text-gray-400" dir="ltr">
                        {l.accounts?.code}
                      </span>{" "}
                      — {l.accounts?.name}
                    </td>
                    <td className="px-4 py-2.5 text-left" dir="ltr">
                      {l.debit ? formatPrice(l.debit) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-left" dir="ltr">
                      {l.credit ? formatPrice(l.credit) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold text-gray-700">
                  <td className="px-4 py-2.5">الإجمالي</td>
                  <td className="px-4 py-2.5 text-left" dir="ltr">
                    {formatPrice(totalDebit)}
                  </td>
                  <td className="px-4 py-2.5 text-left" dir="ltr">
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
