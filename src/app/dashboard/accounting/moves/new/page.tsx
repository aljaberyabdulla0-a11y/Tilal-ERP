import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { MoneyDirection, Partner } from "@/lib/types";
import MoveForm from "../move-form";

// صفحة تسجيل حركة مالية جديدة
export default async function NewMovePage({
  searchParams,
}: {
  searchParams: { dir?: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase.from("partners").select("*").order("created_at");
  const partners = (data ?? []) as Partner[];

  const dir: MoneyDirection = searchParams.dir === "قبض" ? "قبض" : "صرف";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/accounting/moves"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← الحركات المالية
        </Link>
        <h1 className="text-xl font-bold text-brand-700">تسجيل حركة جديدة</h1>
      </header>

      <section className="mx-auto max-w-4xl p-6">
        <MoveForm partners={partners} initialDirection={dir} />
      </section>
    </main>
  );
}
