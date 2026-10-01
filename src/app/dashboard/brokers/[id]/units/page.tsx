import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { BrokerCompany, BrokerCompanyProject, Unit } from "@/lib/types";
import UnitPicker from "./unit-picker";

// ============================================================
// اختيار الوحدات التي تراها الشركة (sql/117) — للمدير.
//
// يعمل حين يكون نطاق الإسناد «مختارة». ولو كان «الكل» فالاختيار
// محفوظ لكنه لا يُطبَّق — والشاشة تقول ذلك صراحةً بدل أن يظنّ المدير
// أنه قيّد الشركة وهو لم يفعل.
// ============================================================
export default async function CompanyUnitsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { project?: string };
}) {
  if (!(await isAdmin())) redirect(`/dashboard/brokers/${params.id}`);

  const supabase = await createClient();
  const [{ data: company }, { data: linkRows }] = await Promise.all([
    supabase.from("broker_companies").select("*").eq("id", params.id).maybeSingle(),
    supabase
      .from("broker_company_projects")
      .select("*, projects(name)")
      .eq("company_id", params.id),
  ]);
  if (!company) notFound();

  const links = (linkRows ?? []) as BrokerCompanyProject[];
  const link = links.find((l) => l.project_id === searchParams.project) ?? links[0];

  let units: Unit[] = [];
  let selected: string[] = [];
  if (link) {
    const [{ data: unitRows }, { data: picked }] = await Promise.all([
      supabase
        .from("units")
        .select("*")
        .eq("project_id", link.project_id)
        .in("status", ["متاحة", "محجوزة"])
        .order("node_path", { nullsFirst: false })
        .order("unit_code"),
      supabase
        .from("broker_visible_units")
        .select("unit_id")
        .eq("company_id", params.id),
    ]);
    units = (unitRows ?? []) as Unit[];
    const inProject = new Set(units.map((u) => u.id));
    selected = (picked ?? [])
      .map((p: { unit_id: string }) => p.unit_id)
      .filter((id: string) => inProject.has(id));
  }

  const c = company as BrokerCompany;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href={`/dashboard/brokers/${c.id}`}
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← {c.name}
        </Link>
        <h1 className="text-xl font-bold text-brand-700">الوحدات الظاهرة للشركة</h1>
      </header>

      <section className="space-y-4 p-6">
        {links.length === 0 ? (
          <p className="text-amber-700">الشركة غير مُسنَدة لأي مشروع.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {links.map((l) => (
                <Link
                  key={l.project_id}
                  href={`?project=${l.project_id}`}
                  className={`rounded-full px-4 py-1.5 text-sm ${
                    l.project_id === link?.project_id
                      ? "bg-brand-600 font-semibold text-white"
                      : "bg-white text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {l.projects?.name ?? "مشروع"}
                </Link>
              ))}
            </div>

            {link && link.units_scope === "الكل" && (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                نطاق هذا المشروع «كل المتاح» — الشركة ترى كل وحداته المتاحة الآن،
                والاختيار أدناه لا يُطبَّق حتى تغيّر النطاق إلى «وحدات مختارة»
                من{" "}
                <Link href={`/dashboard/brokers/${c.id}/edit`} className="font-semibold underline">
                  تعديل الشركة
                </Link>
                .
              </p>
            )}

            {link && (
              <UnitPicker
                key={link.project_id}
                companyId={c.id}
                units={units}
                initialSelected={selected}
              />
            )}
          </>
        )}
      </section>
    </main>
  );
}
