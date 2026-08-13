import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { canEditUnit } from "@/lib/projects";
import { Unit, UNIT_STATUS_COLORS, formatPrice } from "@/lib/types";
import DeleteUnitButton from "../delete-unit-button";

// صفحة تفاصيل وحدة عقارية
export default async function UnitDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("units")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!data) notFound();
  const u = data as Unit;
  const admin = await isAdmin();
  // المشرف يعدّل وحدات مشاريعه فقط
  const canEdit = await canEditUnit(u.project_id, admin);

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="border-b border-gray-100 py-3">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-gray-800">{value || "—"}</dd>
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/units"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← الوحدات العقارية
          </Link>
          <h1 className="text-xl font-bold text-brand-700">
            {u.project} {u.unit_code ? `— ${u.unit_code}` : ""}
          </h1>
        </div>
        {(canEdit || admin) && (
          <div className="flex items-center gap-3">
            {canEdit && (
              <Link
                href={`/dashboard/units/${u.id}/edit`}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                تعديل
              </Link>
            )}
            {/* الحذف للمدير وحده — لا رجعة فيه */}
            {admin && (
              <DeleteUnitButton
                id={u.id}
                label={`${u.project} ${u.unit_code ?? ""}`}
              />
            )}
          </div>
        )}
      </header>

      <section className="p-6">
        <div className="max-w-3xl rounded-2xl bg-white p-8 shadow-sm">
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Field label="المشروع / المجمّع" value={u.project} />
            <Field label="رقم / كود الوحدة" value={u.unit_code} />
            <Field label="نوع الوحدة" value={u.unit_type} />
            <Field
              label="الحالة"
              value={
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    UNIT_STATUS_COLORS[u.status] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {u.status}
                </span>
              }
            />
            <Field label="المحافظة" value={u.governorate} />
            <Field label="المنطقة" value={u.area} />
            <Field
              label="المساحة (م²)"
              value={
                u.space_m2 !== null ? (
                  <span dir="ltr" className="inline-block text-start">
                    {u.space_m2}
                  </span>
                ) : null
              }
            />
            <Field label="عدد الغرف" value={u.rooms !== null ? u.rooms : null} />
            <Field
              label="السعر (دينار عراقي)"
              value={
                u.price !== null ? (
                  <span dir="ltr" className="inline-block text-start">
                    {formatPrice(u.price)}
                  </span>
                ) : null
              }
            />
          </dl>

          <div className="mt-4">
            <dt className="text-sm text-gray-500">ملاحظات</dt>
            <dd className="mt-1 min-h-[80px] whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-gray-800">
              {u.notes || "لا توجد ملاحظات."}
            </dd>
          </div>
        </div>
      </section>
    </main>
  );
}
