import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageHr } from "@/lib/auth";
import { DepartmentMember, Position, canManageOrg, getDepartmentTree } from "@/lib/org";

// لوحة القسم: المدير والأقسام التابعة والمناصب والناس.
// الناس من department_members() — بلا راتب ولا عمولة ولا هاتف، فمدير
// القسم يرى فريقه لا رواتبهم. ومن لا يملك رؤية القسم تُرجعه الدالة.
export default async function DepartmentPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_view_department", { p_dept: params.id });
  if (allowed !== true) redirect("/dashboard/hr/organization");

  const [tree, manage, hr, { data: members, error }, { data: poss }] = await Promise.all([
    getDepartmentTree(true),
    canManageOrg(),
    canManageHr(),
    supabase.rpc("department_members", { p_dept: params.id, p_include_sub: true }),
    supabase.from("positions").select("*").eq("department_id", params.id).order("sort_order"),
  ]);

  const node = tree.find((n) => n.id === params.id);
  if (!node) notFound();

  const people = (members ?? []) as DepartmentMember[];
  const active = people.filter((p) => p.status === "active");
  const children = tree.filter((n) => n.parent_id === node.id);
  const positions = (poss ?? []) as Position[];
  const holders = new Map<string, number>();
  active.forEach((p) => p.position_id && holders.set(p.position_id, (holders.get(p.position_id) ?? 0) + 1));

  // سلسلة الآباء للتنقّل
  const crumbs: { id: string; name_ar: string }[] = [];
  let cur = node.parent_id ? tree.find((n) => n.id === node.parent_id) : undefined;
  while (cur) {
    crumbs.unshift({ id: cur.id, name_ar: cur.name_ar });
    const pid: string | null = cur.parent_id;
    cur = pid ? tree.find((n) => n.id === pid) : undefined;
  }

  const card = "rounded-2xl border bg-white p-5 shadow-sm";
  const h3 = "mb-3 font-semibold text-gray-800";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <Link href="/dashboard/hr/organization" className="hover:text-brand-700">الهيكل التنظيمي</Link>
          {crumbs.map((c) => (
            <span key={c.id}>
              {" › "}
              <Link href={`/dashboard/hr/organization/${c.id}`} className="hover:text-brand-700">{c.name_ar}</Link>
            </span>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-brand-700">{node.name_ar}</h1>
          <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-500" dir="ltr">{node.code}</span>
          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600">{node.unit_type}</span>
          {node.status !== "نشط" && <span className="rounded bg-gray-200 px-2 py-0.5 text-xs">مؤرشف</span>}
        </div>
      </header>

      <section className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className={card}>
            <span className="text-xs text-gray-500">المدير</span>
            <p className="mt-1 font-semibold text-gray-800">{node.manager_name ?? "—"}</p>
          </div>
          <div className={card}>
            <span className="text-xs text-gray-500">على رأس العمل</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{node.total_headcount}</p>
            {node.total_headcount !== node.direct_headcount && (
              <p className="text-xs text-gray-400">{node.direct_headcount} مباشرةً</p>
            )}
          </div>
          <div className={card}>
            <span className="text-xs text-gray-500">الأقسام التابعة</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{children.filter((c) => c.status === "نشط").length}</p>
          </div>
          <div className={card}>
            <span className="text-xs text-gray-500">الفرع</span>
            <p className="mt-1 font-semibold text-gray-800">{node.branch_name ?? "—"}</p>
          </div>
        </div>

        {children.length > 0 && (
          <div className={card}>
            <h3 className={h3}>الأقسام التابعة</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {children.map((c) => (
                <Link key={c.id} href={`/dashboard/hr/organization/${c.id}`}
                  className={`rounded-xl border p-4 transition hover:border-brand-500 ${c.status !== "نشط" ? "opacity-50" : ""}`}>
                  <p className="font-medium text-gray-800">{c.name_ar}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {c.total_headcount} موظف · {c.manager_name ?? "بلا مدير"}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className={card}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">المناصب في هذا القسم</h3>
            {manage && (
              <Link href="/dashboard/hr/positions" className="text-sm text-brand-700 hover:underline">إدارة المناصب ←</Link>
            )}
          </div>
          {positions.length === 0 ? (
            <p className="text-sm text-gray-400">لا مناصب معرّفة مباشرةً في هذا القسم.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-gray-500">
                <tr>
                  <th className="py-2 text-start font-medium">المنصب</th>
                  <th className="py-2 text-start font-medium">يشغله</th>
                  <th className="py-2 text-start font-medium">الملاك المعتمد</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const n = holders.get(p.id) ?? 0;
                  const over = p.headcount_budget != null && n > p.headcount_budget;
                  return (
                    <tr key={p.id} className={`border-b last:border-0 ${p.status !== "نشط" ? "text-gray-400" : ""}`}>
                      <td className="py-2">{p.title_ar} <span className="text-xs text-gray-400" dir="ltr">{p.title_en}</span></td>
                      <td className={`py-2 ${over ? "font-semibold text-amber-600" : ""}`}>{n}</td>
                      <td className="py-2 text-gray-500">{p.headcount_budget ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className={card}>
          <h3 className={h3}>الموظفون ({active.length})</h3>
          {error ? (
            <p className="text-sm text-red-600">{error.message}</p>
          ) : people.length === 0 ? (
            <p className="text-sm text-gray-400">لا موظفين في هذا القسم وما تحته.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b text-gray-500">
                  <tr>
                    <th className="py-2 text-start font-medium">الموظف</th>
                    <th className="py-2 text-start font-medium">المنصب</th>
                    <th className="py-2 text-start font-medium">القسم</th>
                    <th className="py-2 text-start font-medium">المدير المباشر</th>
                    <th className="py-2 text-start font-medium">المباشرة</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id} className={`border-b last:border-0 ${p.status !== "active" ? "text-gray-400" : ""}`}>
                      <td className="py-2">
                        {hr ? (
                          <Link href={`/dashboard/hr/employees/${p.id}`} className="text-brand-700 hover:underline">{p.full_name}</Link>
                        ) : (
                          p.full_name
                        )}
                        <span className="ms-2 font-mono text-[10px] text-gray-400" dir="ltr">{p.employee_code}</span>
                        {p.status !== "active" && <span className="ms-2 text-[10px]">(انتهت خدمته)</span>}
                      </td>
                      <td className="py-2">{p.position_title ?? "—"}</td>
                      <td className="py-2 text-gray-500">{p.department_name ?? "—"}</td>
                      <td className="py-2 text-gray-500">{p.manager_name ?? "—"}</td>
                      <td className="py-2 text-gray-500" dir="ltr">{p.hire_date ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
