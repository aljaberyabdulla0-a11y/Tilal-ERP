import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import {
  Unit,
  UNIT_STATUSES,
  UNIT_STATUS_COLORS,
  formatPrice,
} from "@/lib/types";
import DeleteUnitButton from "./delete-unit-button";
import CrmTabs from "../crm/crm-tabs";

// صفحة قائمة الوحدات العقارية — مع بحث وفلترة حسب الحالة
export default async function UnitsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const supabase = await createClient();

  const q = (searchParams.q ?? "").trim().replace(/[%,()]/g, "");
  const status = searchParams.status ?? "";

  let query = supabase
    .from("units")
    .select("*")
    .order("created_at", { ascending: false });

  if (q) {
    query = query.or(`project.ilike.%${q}%,unit_code.ilike.%${q}%,area.ilike.%${q}%`);
  }
  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  const units = (data ?? []) as Unit[];
  const admin = await isAdmin();

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">CRM</h1>
        </div>
        <Link
          href="/dashboard/units/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + وحدة جديدة
        </Link>
      </header>

      <CrmTabs active="units" />

      <section className="p-6">
        {/* البحث والفلترة */}
        <form className="mb-4 flex flex-wrap gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="ابحث بالمشروع أو الكود أو المنطقة..."
            className="w-full max-w-sm rounded-lg border border-gray-300 px-4 py-2 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <select
            name="status"
            defaultValue={status}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">كل الحالات</option>
            {UNIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-100"
          >
            بحث
          </button>
          {(q || status) && (
            <Link
              href="/dashboard/units"
              className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              مسح
            </Link>
          )}
        </form>

        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            تعذّر جلب الوحدات: {error.message}
            <br />
            تأكّد من تشغيل ملف SQL لإنشاء جدول الوحدات.
          </div>
        )}

        {!error && units.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            {q || status
              ? "لا توجد وحدة مطابقة."
              : "لا توجد وحدات بعد — أضف أول وحدة."}
          </div>
        )}

        {!error && units.length > 0 && (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-right text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">المشروع</th>
                  <th className="px-4 py-3 font-medium">الكود</th>
                  <th className="px-4 py-3 font-medium">النوع</th>
                  <th className="px-4 py-3 font-medium">المحافظة</th>
                  <th className="px-4 py-3 font-medium">المنطقة</th>
                  <th className="px-4 py-3 font-medium">المساحة (م²)</th>
                  <th className="px-4 py-3 font-medium">السعر</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/dashboard/units/${u.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {u.project}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">
                      {u.unit_code || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.unit_type}</td>
                    <td className="px-4 py-3 text-gray-600">{u.governorate || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{u.area || "—"}</td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">
                      {u.space_m2 ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-800" dir="ltr">
                      {formatPrice(u.price)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          UNIT_STATUS_COLORS[u.status] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        href={`/dashboard/units/${u.id}`}
                        className="ml-3 text-sm text-brand-700 hover:underline"
                      >
                        عرض
                      </Link>
                      {admin && (
                        <>
                          <Link
                            href={`/dashboard/units/${u.id}/edit`}
                            className="ml-3 text-sm text-brand-700 hover:underline"
                          >
                            تعديل
                          </Link>
                          <DeleteUnitButton
                            id={u.id}
                            label={`${u.project} ${u.unit_code ?? ""}`}
                          />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && units.length > 0 && (
          <p className="mt-3 text-sm text-gray-500">الإجمالي: {units.length} وحدة</p>
        )}
      </section>
    </main>
  );
}
