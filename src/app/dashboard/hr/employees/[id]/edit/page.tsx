import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { Employee } from "@/lib/types";
import EmployeeForm from "../../employee-form";

export default async function EditEmployeePage({
  params,
}: {
  params: { id: string };
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: employee }, { data: profiles }, { data: employees }] =
    await Promise.all([
      supabase.from("employees").select("*").eq("id", params.id).single(),
      supabase.from("profiles").select("id, email"),
      supabase.from("employees").select("user_id"),
    ]);

  if (!employee) notFound();
  const emp = employee as Employee;

  // الحسابات المتاحة = غير المرتبطة، مع إبقاء الحساب الحالي لهذا الموظف
  const linked = new Set(
    (employees ?? [])
      .map((e: { user_id: string | null }) => e.user_id)
      .filter((uid): uid is string => Boolean(uid) && uid !== emp.user_id)
  );
  const accounts = (profiles ?? []).filter(
    (p: { id: string }) => !linked.has(p.id)
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href={`/dashboard/hr/employees/${emp.id}`}
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← بيانات الموظف
        </Link>
        <h1 className="text-xl font-bold text-brand-700">تعديل: {emp.full_name}</h1>
      </header>

      <section className="p-6">
        <EmployeeForm accounts={accounts} initial={emp} employeeId={emp.id} />
      </section>
    </main>
  );
}
