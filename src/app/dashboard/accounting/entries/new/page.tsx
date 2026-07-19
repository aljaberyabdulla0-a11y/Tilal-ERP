import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Account } from "@/lib/types";
import EntryForm from "../entry-form";

export default async function NewEntryPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("accounts")
    .select("*")
    .eq("is_active", true)
    .order("code");

  const accounts = (data ?? []) as Account[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/accounting/entries"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← قيود اليومية
        </Link>
        <h1 className="text-xl font-bold text-brand-700">قيد جديد</h1>
      </header>

      <section className="p-6">
        {accounts.length === 0 ? (
          <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-700">
            لا توجد حسابات بعد. تأكّد من تشغيل ملف SQL للمحاسبة أولاً.
          </p>
        ) : (
          <EntryForm accounts={accounts} />
        )}
      </section>
    </main>
  );
}
