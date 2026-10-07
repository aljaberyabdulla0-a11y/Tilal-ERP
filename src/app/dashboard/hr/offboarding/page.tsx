import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance, canManageHr, isAdmin } from "@/lib/auth";
import OffboardingCase, { NewTermination } from "./offboarding-case";

type Term = { id: string; employee_id: string; term_type: string; last_working_day: string; reason: string;
  successor_id: string | null; status: string; settlement: Record<string, unknown> | null; created_at: string };
type Item = { id: string; termination_id: string; department: string; title: string; auto_rule: string | null;
  status: string; completed_by_name: string | null; note: string | null };

// إنهاء الخدمة (sql/163): الطلب ← الموافقات ← إخلاء الطرف ← التسوية ← الإكمال.
// كل حساب في القاعدة؛ والإكمال للمدير ويُرفض قبل اكتمال الإخلاء.
export default async function OffboardingPage() {
  const [hr, finance, admin] = await Promise.all([canManageHr(), canManageFinance(), isAdmin()]);
  if (!hr && !finance) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: terms }, { data: items }, { data: emps }] = await Promise.all([
    supabase.from("termination_requests").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("clearance_items").select("*"),
    supabase.from("employees").select("id, full_name, status").order("full_name"),
  ]);
  const people = (emps ?? []) as { id: string; full_name: string; status: string }[];
  const active = people.filter((p) => p.status === "active");
  const list = (terms ?? []) as Term[];

  // معاينة التسوية لكل طلب معتمد — من القاعدة
  const previews: Record<string, Record<string, unknown> | null> = {};
  await Promise.all(
    list.filter((t) => t.status === "معتمد").map(async (t) => {
      const { data } = await supabase.rpc("final_settlement_preview", { p_termination: t.id });
      previews[t.id] = (data as Record<string, unknown>) ?? null;
    })
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/hr" className="text-sm text-gray-500 hover:text-brand-700">← الموارد البشرية</Link>
        <h1 className="text-xl font-bold text-brand-700">إنهاء الخدمة وإخلاء الطرف</h1>
      </header>
      <section className="space-y-4 p-6">
        {hr && <NewTermination employees={active} />}
        {list.length === 0 && (
          <p className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-gray-400">لا طلبات إنهاء.</p>
        )}
        {list.map((t) => (
          <OffboardingCase
            key={t.id}
            term={t}
            name={people.find((p) => p.id === t.employee_id)?.full_name ?? "—"}
            successorName={people.find((p) => p.id === t.successor_id)?.full_name ?? null}
            items={((items ?? []) as Item[]).filter((i) => i.termination_id === t.id)}
            preview={previews[t.id] ?? t.settlement ?? null}
            candidates={active.filter((p) => p.id !== t.employee_id)}
            isHr={hr}
            isFinance={finance}
            isAdmin={admin}
          />
        ))}
      </section>
    </main>
  );
}
