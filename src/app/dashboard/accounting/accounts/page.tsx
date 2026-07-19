import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Account, ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@/lib/types";

// شجرة الحسابات — مجمّعة حسب النوع
export default async function AccountsPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .order("code", { ascending: true });

  const accounts = (data ?? []) as Account[];

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
          <h1 className="text-xl font-bold text-brand-700">شجرة الحسابات</h1>
        </div>
        <Link
          href="/dashboard/accounting/accounts/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + حساب جديد
        </Link>
      </header>

      <section className="p-6">
        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            تعذّر جلب الحسابات: {error.message}
            <br />
            تأكّد من تشغيل ملف SQL للمحاسبة.
          </div>
        )}

        {!error && (
          <div className="space-y-6">
            {ACCOUNT_TYPE_ORDER.map((type) => {
              const group = accounts.filter((a) => a.type === type);
              if (group.length === 0) return null;
              return (
                <div key={type} className="rounded-lg border bg-white shadow-sm">
                  <div className="border-b bg-gray-50 px-4 py-2 font-semibold text-gray-700">
                    {ACCOUNT_TYPE_LABELS[type]}
                  </div>
                  <table className="w-full text-right text-sm">
                    <tbody>
                      {group.map((a) => (
                        <tr key={a.id} className="border-b last:border-0">
                          <td className="w-24 px-4 py-2.5 font-mono text-gray-500" dir="ltr">
                            {a.code}
                          </td>
                          <td className="px-4 py-2.5 text-gray-800">{a.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
