import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageInventory } from "@/lib/auth";
import { getInventoryItems, lowStockItems } from "@/lib/inventory";
import {
  INVENTORY_CATEGORY_COLORS,
  InventoryMove,
  STOCK_STATE_COLORS,
  formatPrice,
  formatQty,
  stockState,
} from "@/lib/types";
import InventoryTabs from "../inventory-tabs";

const PERIODS = [
  { key: "30", label: "آخر ٣٠ يوم" },
  { key: "90", label: "آخر ٣ أشهر" },
  { key: "365", label: "آخر سنة" },
  { key: "all", label: "كل الفترات" },
];

function periodStart(days: number): string {
  const d = new Date(Date.now() - days * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" });
}

// ============================================================
// تقارير المخزون — ثلاثة أسئلة تُسأل شهرياً:
//   • كم أنفقنا وعلى أي تصنيف؟
//   • ما أكثر المواد استهلاكاً؟ (عليها تُبنى قرارات الشراء)
//   • ما الذي يجب شراؤه الآن؟
// ============================================================
export default async function InventoryReportsPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  if (!(await canManageInventory())) redirect("/dashboard");

  const period = searchParams.period ?? "30";
  const supabase = await createClient();

  let query = supabase
    .from("inventory_moves")
    .select("*, inventory_items(name, unit, category), suppliers(name)")
    .limit(2000);
  if (period !== "all") query = query.gte("moved_at", periodStart(Number(period) || 30));

  const [{ data }, items] = await Promise.all([query, getInventoryItems()]);
  const moves = (data ?? []) as InventoryMove[];

  // ===== حسب التصنيف =====
  type Row = { purchased: number; issued: number; value: number; items: number };
  const byCategory = new Map<string, Row>();
  items.forEach((i) => {
    const row = byCategory.get(i.category) ?? { purchased: 0, issued: 0, value: 0, items: 0 };
    row.items += 1;
    byCategory.set(i.category, row);
  });
  moves.forEach((m) => {
    const cat = m.inventory_items?.category ?? "مستلزمات أخرى";
    const row = byCategory.get(cat) ?? { purchased: 0, issued: 0, value: 0, items: 0 };
    if (m.kind === "شراء") {
      row.purchased += m.quantity;
      row.value += m.total_price ?? 0;
    } else if (m.kind === "صرف") {
      row.issued += m.quantity;
    }
    byCategory.set(cat, row);
  });
  const categories = Array.from(byCategory.entries()).sort(
    (a, b) => b[1].value - a[1].value
  );

  // ===== أكثر المواد استهلاكاً =====
  const consumption = new Map<string, { name: string; unit: string; qty: number }>();
  moves
    .filter((m) => m.kind === "صرف")
    .forEach((m) => {
      const cur = consumption.get(m.item_id) ?? {
        name: m.inventory_items?.name ?? "—",
        unit: m.inventory_items?.unit ?? "",
        qty: 0,
      };
      cur.qty += m.quantity;
      consumption.set(m.item_id, cur);
    });
  const topConsumed = Array.from(consumption.values())
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);
  const maxConsumed = Math.max(1, ...topConsumed.map((c) => c.qty));

  // ===== المشتريات حسب المورد =====
  const bySupplier = new Map<string, { count: number; value: number }>();
  moves
    .filter((m) => m.kind === "شراء")
    .forEach((m) => {
      const name = m.suppliers?.name ?? "بلا مورد محدّد";
      const cur = bySupplier.get(name) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += m.total_price ?? 0;
      bySupplier.set(name, cur);
    });
  const suppliers = Array.from(bySupplier.entries()).sort(
    (a, b) => b[1].value - a[1].value
  );

  const totalSpent = moves
    .filter((m) => m.kind === "شراء")
    .reduce((s, m) => s + (m.total_price ?? 0), 0);
  const low = lowStockItems(items);

  const inputCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">المخزون</h1>
      </header>

      <InventoryTabs active="reports" />

      <section className="space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form className="flex gap-2">
            <select name="period" defaultValue={period} className={inputCls}>
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              تطبيق
            </button>
          </form>
          <div className="glass-card border-s-4 border-s-blue-500 px-5 py-3">
            <span className="text-sm text-gray-500">إجمالي الإنفاق في الفترة</span>
            <p className="text-2xl font-bold text-blue-700" dir="ltr">
              {formatPrice(totalSpent)}
            </p>
          </div>
        </div>

        {/* حسب التصنيف */}
        <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-6 py-4">
            <h2 className="text-lg font-bold text-gray-800">حسب التصنيف</h2>
          </div>
          <table className="w-full min-w-[700px] text-start text-sm">
            <thead className="border-b bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-start font-medium">التصنيف</th>
                <th className="px-4 py-3 text-start font-medium">عدد المواد</th>
                <th className="px-4 py-3 text-start font-medium">المشترى</th>
                <th className="px-4 py-3 text-start font-medium">المصروف</th>
                <th className="px-4 py-3 text-start font-medium">قيمة الشراء</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(([cat, row]) => (
                <tr key={cat} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        INVENTORY_CATEGORY_COLORS[cat] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {cat}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.items}</td>
                  <td className="px-4 py-3 text-emerald-700" dir="ltr">
                    {formatQty(row.purchased)}
                  </td>
                  <td className="px-4 py-3 text-red-700" dir="ltr">
                    {formatQty(row.issued)}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-800" dir="ltr">
                    {formatPrice(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* أكثر المواد استهلاكاً */}
          <div className="glass-card p-6">
            <h2 className="mb-4 text-lg font-bold text-gray-800">
              أكثر المواد استهلاكاً
            </h2>
            {topConsumed.length === 0 ? (
              <p className="text-sm text-gray-400">لا صرف مسجّل في هذه الفترة.</p>
            ) : (
              <div className="space-y-3">
                {topConsumed.map((c) => (
                  <div key={c.name}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium text-gray-700">{c.name}</span>
                      <span className="text-gray-500" dir="ltr">
                        {formatQty(c.qty)} {c.unit}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-100">
                      <div
                        className="h-2 rounded-full bg-brand-600"
                        style={{ width: `${Math.max(4, (c.qty / maxConsumed) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* المشتريات حسب المورد */}
          <div className="glass-card p-6">
            <h2 className="mb-4 text-lg font-bold text-gray-800">
              المشتريات حسب المورد
            </h2>
            {suppliers.length === 0 ? (
              <p className="text-sm text-gray-400">لا مشتريات في هذه الفترة.</p>
            ) : (
              <div className="space-y-2">
                {suppliers.map(([name, s]) => (
                  <div
                    key={name}
                    className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3"
                  >
                    <div>
                      <span className="font-medium text-gray-800">{name}</span>
                      <span className="block text-xs text-gray-400">
                        {s.count} عملية شراء
                      </span>
                    </div>
                    <span className="font-bold text-gray-800" dir="ltr">
                      {formatPrice(s.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ما يجب شراؤه الآن */}
        <div className="glass-card p-6">
          <h2 className="mb-4 text-lg font-bold text-gray-800">
            قائمة الشراء المقترحة ({low.length})
          </h2>
          {low.length === 0 ? (
            <p className="text-sm text-emerald-700">
              كل المواد فوق حدّها الأدنى — لا شيء عاجل.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-start text-sm">
                <thead className="border-b text-gray-600">
                  <tr>
                    <th className="px-4 py-2 text-start font-medium">المادة</th>
                    <th className="px-4 py-2 text-start font-medium">المتبقي</th>
                    <th className="px-4 py-2 text-start font-medium">الحد الأدنى</th>
                    <th className="px-4 py-2 text-start font-medium">النقص</th>
                    <th className="px-4 py-2 text-start font-medium">المورد</th>
                  </tr>
                </thead>
                <tbody>
                  {low.map((i) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <Link
                          href={`/dashboard/inventory/${i.id}`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          {i.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                            STOCK_STATE_COLORS[stockState(i)]
                          }`}
                        >
                          {formatQty(i.quantity)} {i.unit}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-600">
                        {formatQty(i.min_quantity)}
                      </td>
                      <td className="px-4 py-2 font-semibold text-amber-700">
                        {formatQty(Math.max(0, i.min_quantity - i.quantity))}
                      </td>
                      <td className="px-4 py-2 text-gray-600">
                        {i.suppliers?.name ?? "—"}
                      </td>
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
