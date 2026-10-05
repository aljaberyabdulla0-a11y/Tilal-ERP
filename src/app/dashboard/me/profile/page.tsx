import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyEmployee } from "@/lib/hr";
import { baghdadDate } from "@/lib/time";
import {
  EMPLOYMENT_STATUS_STYLE,
  EmployeeDocument,
  EmployeeDocumentType,
  TimelineEvent,
} from "@/lib/types";
import EmployeeDocumentsPanel from "@/components/employee-documents-panel";
import EmployeeTimeline from "@/components/employee-timeline";
import MyContactForm from "./my-contact-form";

// ملفي (sql/148): بياناتي ومستنداتي وخطّي الزمني. الموظف يرى ملفه وحده
// (RLS على employees والمستندات، و employee_timeline تفحص الهوية).
export default async function MyProfilePage() {
  const emp = await getMyEmployee();
  if (!emp) redirect("/dashboard/me");

  const supabase = await createClient();
  const [{ data: docs }, { data: types }, { data: timeline, error: tlErr }, { data: pos }] =
    await Promise.all([
      supabase.from("employee_documents").select("*").eq("employee_id", emp.id).order("created_at", { ascending: false }),
      supabase.from("employee_document_types").select("*").order("sort_order"),
      supabase.rpc("employee_timeline", { p_employee: emp.id, p_limit: 60 }),
      emp.position_id
        ? supabase.from("positions").select("title_ar, job_description, responsibilities").eq("id", emp.position_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const position = pos as { title_ar: string; job_description: string | null; responsibilities: string | null } | null;
  const row = (k: string, v: string | null | undefined, ltr = false) => (
    <div>
      <dt className="text-gray-500">{k}</dt>
      <dd className="font-medium" dir={ltr ? "ltr" : undefined}>{v || "—"}</dd>
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/me" className="text-sm text-gray-500 hover:text-brand-700">← بوابتي</Link>
        <h1 className="text-xl font-bold text-brand-700">ملفي</h1>
      </header>

      <section className="space-y-6 p-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold text-gray-800">{emp.full_name}</h3>
            <span className="font-mono text-xs text-gray-400" dir="ltr">{emp.employee_code}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${EMPLOYMENT_STATUS_STYLE[emp.employment_status] ?? "bg-gray-100"}`}>
              {emp.employment_status}
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            {row("المنصب", emp.job_title)}
            {row("القسم", emp.department)}
            {row("تاريخ المباشرة", emp.hire_date, true)}
            {(emp.probation_start || emp.probation_end) &&
              row("فترة التجربة", `${emp.probation_start ?? "—"} → ${emp.probation_end ?? "—"}`, true)}
            {row("الاسم بالإنجليزية", emp.name_en, true)}
            {row("تاريخ الميلاد", emp.birth_date, true)}
            {row("الجنسية", emp.nationality)}
            {row("البنك", [emp.bank_name, emp.bank_iban].filter(Boolean).join(" — ") || null)}
          </dl>
          {position?.responsibilities && (
            <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm">
              <p className="mb-1 font-medium text-gray-700">مسؤوليات منصبي</p>
              <p className="whitespace-pre-line text-gray-600">{position.responsibilities}</p>
            </div>
          )}
          <p className="mt-3 text-xs text-gray-400">
            لتصحيح بياناتك الرسمية أو البنكية راجع الموارد البشرية — كل تعديل عليها مسجَّل.
          </p>
        </div>

        <MyContactForm
          initial={{
            phone: emp.phone ?? "",
            email: emp.email ?? "",
            address: emp.address ?? "",
            emergency_contact_name: emp.emergency_contact_name ?? "",
            emergency_contact_phone: emp.emergency_contact_phone ?? "",
            emergency_contact_relation: emp.emergency_contact_relation ?? "",
          }}
        />

        <EmployeeDocumentsPanel
          employeeId={emp.id}
          documents={(docs ?? []) as EmployeeDocument[]}
          types={(types ?? []) as EmployeeDocumentType[]}
          canWrite={false}
          today={baghdadDate()}
        />

        <EmployeeTimeline events={(timeline ?? []) as TimelineEvent[]} error={tlErr?.message} />
      </section>
    </main>
  );
}
