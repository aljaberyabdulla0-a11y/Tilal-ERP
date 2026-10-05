import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageHr, getCurrentUser, isAdmin } from "@/lib/auth";
import { Department, Position, departmentLabel, getMyManagedDepartmentIds } from "@/lib/org";
import { JobOpening, JobRequisition, REQUISITION_STYLE } from "@/lib/recruitment";
import { formatPrice } from "@/lib/types";
import RequisitionForm from "./requisition-form";
import RequisitionActions from "./requisition-actions";

// التوظيف (sql/150): طلبات التوظيف والوظائف المفتوحة.
// HR ترى كل شيء وتديره، ومدير القسم يطلب لقسمه ويتابع طلباته ووظائفه.
export default async function RecruitmentPage() {
  const supabase = await createClient();
  const [{ data: canRead }, { data: canManage }, admin, hr, managed, user] = await Promise.all([
    supabase.rpc("can_read_recruitment"),
    supabase.rpc("can_manage_recruitment"),
    isAdmin(),
    canManageHr(),
    getMyManagedDepartmentIds(),
    getCurrentUser(),
  ]);
  if (canRead !== true && managed.length === 0) redirect("/dashboard/me");

  const [{ data: reqs }, { data: opens }, { data: deps }, { data: poss }, { data: apps }] = await Promise.all([
    supabase.from("job_requisitions").select("*").order("created_at", { ascending: false }),
    supabase.from("job_openings").select("*").order("opened_at", { ascending: false }),
    supabase.from("departments").select("*").eq("status", "نشط").order("sort_order"),
    supabase.from("positions").select("*").eq("status", "نشط").order("sort_order"),
    supabase.from("job_applications").select("opening_id, stage"),
  ]);

  const requisitions = (reqs ?? []) as JobRequisition[];
  const openings = (opens ?? []) as JobOpening[];
  const departments = (deps ?? []) as Department[];
  const positions = (poss ?? []) as Position[];
  const depName = (id: string) => departments.find((d) => d.id === id)?.name_ar ?? "—";

  const pipeline: Record<string, { active: number; hired: number }> = {};
  ((apps ?? []) as { opening_id: string; stage: string }[]).forEach((a) => {
    const p = (pipeline[a.opening_id] ??= { active: 0, hired: 0 });
    if (a.stage === "تم التعيين") p.hired++;
    else if (!["مرفوض", "انسحب"].includes(a.stage)) p.active++;
  });

  const requestable = canManage === true ? departments : departments.filter((d) => managed.includes(d.id));
  const pending = requisitions.filter((r) => r.status === "بانتظار HR" || r.status === "بانتظار الإدارة").length;
  const open = openings.filter((o) => o.status === "مفتوحة");
  const inPipeline = Object.values(pipeline).reduce((s, p) => s + p.active, 0);

  const card = "rounded-2xl border bg-white p-5 shadow-sm";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href={hr ? "/dashboard/hr" : "/dashboard/me"} className="text-sm text-gray-500 hover:text-brand-700">
          ← {hr ? "الموارد البشرية" : "بوابتي"}
        </Link>
        <h1 className="text-xl font-bold text-brand-700">التوظيف</h1>
      </header>

      <section className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className={card}>
            <span className="text-xs text-gray-500">طلبات بانتظار قرار</span>
            <p className="mt-1 text-2xl font-bold text-amber-600">{pending}</p>
          </div>
          <div className={card}>
            <span className="text-xs text-gray-500">وظائف مفتوحة</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{open.length}</p>
          </div>
          <div className={card}>
            <span className="text-xs text-gray-500">مرشحون في المسار</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{inPipeline}</p>
          </div>
          <div className={card}>
            <span className="text-xs text-gray-500">شواغر مطلوبة</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">
              {open.reduce((s, o) => s + o.headcount - (pipeline[o.id]?.hired ?? 0), 0)}
            </p>
          </div>
        </div>

        {requestable.length > 0 && (
          <RequisitionForm
            departments={requestable}
            allDepartments={departments}
            positions={positions}
          />
        )}

        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-3 font-semibold text-gray-800">طلبات التوظيف</div>
          {requisitions.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">لا طلبات بعد.</p>
          ) : (
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">الطلب</th>
                  <th className="px-4 py-2 text-start font-medium">القسم</th>
                  <th className="px-4 py-2 text-start font-medium">العدد / السبب</th>
                  <th className="px-4 py-2 text-start font-medium">النطاق</th>
                  <th className="px-4 py-2 text-start font-medium">الطالب</th>
                  <th className="px-4 py-2 text-start font-medium">الحالة</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {requisitions.map((r) => (
                  <tr key={r.id} className="border-b align-top last:border-0">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-800">{r.title}</p>
                      <p className="font-mono text-[10px] text-gray-400" dir="ltr">{r.req_no}</p>
                      {r.justification && <p className="mt-1 max-w-xs text-xs text-gray-500">{r.justification}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{departmentLabel({ id: r.department_id }, departments) || depName(r.department_id)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.headcount} · {r.reason}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-600" dir="ltr">
                      {r.salary_min != null || r.salary_max != null
                        ? `${r.salary_min != null ? formatPrice(r.salary_min) : "—"} – ${r.salary_max != null ? formatPrice(r.salary_max) : "—"}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {r.requested_by_name}
                      <span className="block" dir="ltr">{r.created_at.slice(0, 10)}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${REQUISITION_STYLE[r.status] ?? "bg-gray-100"}`}>{r.status}</span>
                      {(r.hr_note || r.mgmt_note) && (
                        <p className="mt-1 max-w-[12rem] text-[11px] text-gray-500">{r.mgmt_note ?? r.hr_note}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <RequisitionActions
                        id={r.id}
                        status={r.status}
                        mine={r.requested_by === user?.id}
                        canHr={hr}
                        canMgmt={admin}
                        canCancel={r.requested_by === user?.id || canManage === true}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-3 font-semibold text-gray-800">الوظائف</div>
          {openings.length === 0 ? (
            <p className="p-5 text-sm text-gray-400">لا وظائف — تُفتح تلقائياً حين تعتمد الإدارة طلب توظيف.</p>
          ) : (
            <table className="w-full min-w-[700px] text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">الوظيفة</th>
                  <th className="px-4 py-2 text-start font-medium">القسم</th>
                  <th className="px-4 py-2 text-start font-medium">في المسار</th>
                  <th className="px-4 py-2 text-start font-medium">عُيّن / المطلوب</th>
                  <th className="px-4 py-2 text-start font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {openings.map((o) => (
                  <tr key={o.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/hr/recruitment/${o.id}`} className="font-medium text-brand-700 hover:underline">
                        {o.title}
                      </Link>
                      <span className="ms-2 font-mono text-[10px] text-gray-400" dir="ltr">{o.opening_no}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{depName(o.department_id)}</td>
                    <td className="px-4 py-2.5">{pipeline[o.id]?.active ?? 0}</td>
                    <td className="px-4 py-2.5">{pipeline[o.id]?.hired ?? 0} / {o.headcount}</td>
                    <td className="px-4 py-2.5 text-gray-600">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}
