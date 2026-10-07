import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageHr, isAdmin } from "@/lib/auth";
import { LeavePolicies, Workflows, Shifts, OvertimeFactors, EndOfService } from "./settings-sections";

// إعدادات HR (المراحل 1–4): سياسات الإجازات، سلاسل الموافقة، الورديات،
// معاملات العمل الإضافي. الأرقام هنا يضعها المالك — لا رقم مزروع في الواجهة.
export default async function HrSettingsPage() {
  if (!(await canManageHr())) redirect("/dashboard");
  const admin = await isAdmin();
  const supabase = await createClient();

  const [{ data: types }, { data: wfs }, { data: steps }, { data: roles }, { data: shifts }, { data: assigns },
         { data: emps }, { data: cfg }] = await Promise.all([
    supabase.from("leave_types").select("*").order("sort_order"),
    supabase.from("approval_workflows").select("*").order("code"),
    supabase.from("approval_steps").select("*").order("step_no"),
    supabase.from("roles").select("code, name_ar").eq("status", "نشط").order("sort_order"),
    supabase.from("work_shifts").select("*").order("start_time"),
    supabase.from("employee_shifts").select("*").order("start_date", { ascending: false }),
    supabase.from("employees").select("id, full_name").eq("status", "active").order("full_name"),
    supabase.from("company_settings").select("overtime_factor_workday, overtime_factor_offday, eos_days_per_year, eos_min_years").eq("id", 1).maybeSingle(),
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/hr" className="text-sm text-gray-500 hover:text-brand-700">← الموارد البشرية</Link>
        <h1 className="text-xl font-bold text-brand-700">إعدادات HR</h1>
      </header>
      <section className="space-y-8 p-6">
        <LeavePolicies types={types ?? []} workflows={wfs ?? []} />
        <Workflows workflows={wfs ?? []} steps={steps ?? []} roles={roles ?? []} canEdit={admin} />
        <Shifts shifts={shifts ?? []} assignments={assigns ?? []} employees={emps ?? []} />
        <OvertimeFactors
          workday={(cfg as { overtime_factor_workday: number | null } | null)?.overtime_factor_workday ?? null}
          offday={(cfg as { overtime_factor_offday: number | null } | null)?.overtime_factor_offday ?? null}
          canEdit={true}
        />
        <EndOfService
          days={(cfg as { eos_days_per_year: number | null } | null)?.eos_days_per_year ?? null}
          minYears={(cfg as { eos_min_years: number | null } | null)?.eos_min_years ?? null}
        />
      </section>
    </main>
  );
}
