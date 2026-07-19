import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import AccountForm from "../account-form";

export default async function NewAccountPage() {
  if (!(await isAdmin())) redirect("/dashboard");

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/accounting/accounts"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← شجرة الحسابات
        </Link>
        <h1 className="text-xl font-bold text-brand-700">حساب جديد</h1>
      </header>

      <section className="p-6">
        <AccountForm />
      </section>
    </main>
  );
}
