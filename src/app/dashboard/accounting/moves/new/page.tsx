import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/auth";
import { MoneyDirection, Partner } from "@/lib/types";
import MoveForm from "../move-form";

// صفحة تسجيل حركة مالية جديدة
export default async function NewMovePage({
  searchParams,
}: {
  searchParams: { dir?: string };
}) {
  if (!(await canManageFinance())) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data }, { data: pj }] = await Promise.all([
    supabase.from("partners").select("*").order("created_at"),
    supabase.from("projects").select("id, name").order("name"),
  ]);
  const partners = (data ?? []) as Partner[];
  const projects = (pj ?? []) as { id: string; name: string }[];

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
        <MoveForm partners={partners} projects={projects} initialDirection={dir} />
      </section>
    </main>
  );
}
