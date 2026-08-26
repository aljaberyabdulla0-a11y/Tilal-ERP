import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageInventory } from "@/lib/auth";
import { getInventoryItems, lowStockItems, summarize } from "@/lib/inventory";
import {
  INVENTORY_CATEGORIES,
  INVENTORY_CATEGORY_COLORS,
  INVENTORY_CATEGORY_ICONS,
  STOCK_STATE_COLORS,
  formatPrice,
  formatQty,
  nameKey,
  stockState,
} from "@/lib/types";
import InventoryTabs from "./inventory-tabs";

// ============================================================
// المخزون — قائمة المواد.
//
// السؤال الذي تجيب عنه هذه الشاشة بترتيب الأهمية:
//   1) ما الذي أوشك على النفاد؟ (شريط التنبيه أعلى الصفحة)
//   2) كم بقي من كل مادة؟      (عمود الرصيد)
//   3) أين أسجّل شراءً أو صرفاً؟ (زرّان في كل صف)
//
// الرصيد هنا **عرض فقط** — لا يُحرَّر في أي شاشة، بل ينتج عن
// الحركات (sql/040).
// ============================================================
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: { q?: string; category?: string; state?: string };
}) {
  if (!(await canManageInventory())) redirect("/dashboard");

  const items = await getInventoryItems();

  const q = nameKey(searchParams.q ?? "");
  const category = searchParams.category ?? "";
  const onlyLow = searchParams.state === "low";

  const low = lowStockItems(items);
  const summary = summarize(items);

  // الفلترة في الذاكرة: عدد المواد بالعشرات لا بالآلاف، فرحلة واحدة
  // للقاعدة أرخص من استعلام لكل تغيير فلتر.
  const filtered = items.filter((i) => {
    if (q && !nameKey(i.name).includes(q) && !nameKey(i.notes).includes(q)) return false;
    if (category && i.category !== category) return false;
    if (onlyLow && stockState(i) === "جيدة") return false;
    return true;
  });

  const kpi = "glass-card border-s-4 p-5";
  const inputCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">المخزون</h1>
            <p className="text-sm text-gray-500">
              مواد مركز المبيعات: الموجود والمشترى والمصروف.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/inventory/moves/new"
            className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
          >
            تسجيل حركة
          </Link>
          <Link
            href="/dashboard/inventory/new"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            + مادة جديدة
          </Link>
        </div>
      </header>

      <InventoryTabs active="items" />

      <section className="space-y-5 p-6">
        {/* المؤشرات */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className={kpi + " border-s-brand-500"}>
            <span className="text-sm text-gray-500">المواد</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">{summary.items}</p>
          </div>
          <div className={kpi + (summary.low ? " border-s-amber-500" : " border-s-emerald-500")}>
            <span className="text-sm text-gray-500">تحت الحد الأدنى</span>
            <p
              className={`mt-1 text-2xl font-bold ${
                summary.low ? "text-amber-700" : "text-emerald-700"
              }`}
            >
              {summary.low}
            </p>
          </div>
          <div className={kpi + (summary.out ? " border-s-red-500" : " border-s-emerald-500")}>
            <span className="text-sm text-gray-500">نفدت تماماً</span>
            <p
              className={`mt-1 text-2xl font-bold ${
                summary.out ? "text-red-700" : "text-emerald-700"
              }`}
            >
              {summary.out}
            </p>
          </div>
          <div className={kpi + " border-s-blue-500"}>
            <span className="text-sm text-gray-500">التصنيفات</span>
            <p className="mt-1 text-2xl font-bold text-blue-700">{summary.categories}</p>
          </div>
        </div>

        {/* تنبيه النقص — أول ما يجب أن يُرى */}
        {low.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-700">warning</span>
              <b className="text-amber-800">مواد تحتاج شراءً ({low.length})</b>
            </div>
            <div className="flex flex-wrap gap-2">
              {low.slice(0, 12).map((i) => (
                <Link
                  key={i.id}
                  href={`/dashboard/inventory/${i.id}`}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition hover:opacity-80 ${
                    STOCK_STATE_COLORS[stockState(i)]
                  }`}
                >
                  {i.name} — {formatQty(i.quantity)} {i.unit}
                </Link>
              ))}
              {low.length > 12 && (
                <Link
                  href="/dashboard/inventory?state=low"
                  className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-amber-800"
                >
                  و{low.length - 12} غيرها…
                </Link>
              )}
            </div>
          </div>
        )}

        {/* البحث والفلترة */}
        <form className="flex flex-wrap gap-2">
          <input
            type="text"
            name="q"
            defaultValue={searchParams.q ?? ""}
            placeholder="ابحث باسم المادة..."
            className={inputCls + " w-full max-w-sm"}
          />
          <select name="category" defaultValue={category} className={inputCls}>
            <option value="">كل التصنيفات</option>
            {INVENTORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select name="state" defaultValue={searchParams.state ?? ""} className={inputCls}>
            <option value="">كل الحالات</option>
            <option value="low">تحتاج متابعة فقط</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            بحث
          </button>
          {(searchParams.q || category || searchParams.state) && (
            <Link
              href="/dashboard/inventory"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
            >
              مسح الفلاتر
            </Link>
          )}
        </form>

        {/* الجدول */}
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            {items.length === 0
              ? "لا توجد مواد بعد. ابدأ بإضافة مادة (ماء، مناديل، مطبوعات…) ثم سجّل مشترياتك."
              : "لا توجد مواد مطابقة للبحث."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">المادة</th>
                  <th className="px-4 py-3 text-start font-medium">التصنيف</th>
                  <th className="px-4 py-3 text-start font-medium">الرصيد</th>
                  <th className="px-4 py-3 text-start font-medium">الحد الأدنى</th>
                  <th className="px-4 py-3 text-start font-medium">المورد</th>
                  <th className="px-4 py-3 text-start font-medium">آخر شراء</th>
                  <th className="px-4 py-3 text-start font-medium">سعر الوحدة</th>
                  <th className="px-4 py-3 text-start font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const state = stockState(i);
                  return (
                    <tr key={i.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/inventory/${i.id}`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          {i.name}
                        </Link>
                        {!i.is_active && (
                          <span className="ms-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                            موقوفة
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            INVENTORY_CATEGORY_COLORS[i.category] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {INVENTORY_CATEGORY_ICONS[i.category] ?? "inventory_2"}
                          </span>
                          {i.category}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${STOCK_STATE_COLORS[state]}`}
                        >
                          {formatQty(i.quantity)} {i.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {formatQty(i.min_quantity)} {i.unit}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {i.suppliers?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500" dir="ltr">
                        {i.last_purchase_date ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600" dir="ltr">
                        {formatPrice(i.last_purchase_price)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Link
                            href={`/dashboard/inventory/moves/new?item=${i.id}&kind=${encodeURIComponent("شراء")}`}
                            className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                          >
                            شراء
                          </Link>
                          <Link
                            href={`/dashboard/inventory/moves/new?item=${i.id}&kind=${encodeURIComponent("صرف")}`}
                            className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                          >
                            صرف
                          </Link>
                          <Link
                            href={`/dashboard/inventory/${i.id}/edit`}
                            className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 transition hover:bg-gray-100"
                          >
                            تعديل
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
