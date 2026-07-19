import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { JournalEntry, JournalLine, formatPrice } from "@/lib/types";

// قائمة قيود اليومية
export default async function EntriesPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .select("*, journal_lines(debit)")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });

  const entries = (data ?? []) as JournalEntry[];

  // مجموع القيد = مجموع الطرف المدين لسطوره
  const entryTotal = (e: JournalEntry) =>
    (e.journal_lines ?? []).reduce((s, l: JournalLine) => s + (l.debit ?? 0), 0);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/accounting"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← المحاسبة
          </Link>
          <h1 className="text-xl font-bold text-brand-700">قيود اليومية</h1>
        </div>
        <Link
          href="/dashboard/accounting/entries/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + قيد جديد
        </Link>
      </header>

      <section className="p-6">
        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            تعذّر جلب القيود: {error.message}
          </div>
        )}

        {!error && entries.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا توجد قيود بعد — أضف أول قيد.
          </div>
        )}

        {!error && entries.length > 0 && (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[600px] text-right text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">التاريخ</th>
                  <th className="px-4 py-3 font-medium">البيان</th>
                  <th className="px-4 py-3 font-medium">المبلغ</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600" dir="ltr">
                      {e.entry_date}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      <Link
                        href={`/dashboard/accounting/entries/${e.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {e.description}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-800" dir="ltr">
                      {formatPrice(entryTotal(e))}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/accounting/entries/${e.id}`}
                        className="text-sm text-brand-700 hover:underline"
                      >
                        عرض
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && entries.length > 0 && (
          <p className="mt-3 text-sm text-gray-500">عدد القيود: {entries.length}</p>
        )}
      </section>
    </main>
  );
}
