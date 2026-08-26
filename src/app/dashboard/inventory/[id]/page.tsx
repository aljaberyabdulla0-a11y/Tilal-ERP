import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageInventory } from "@/lib/auth";
import { getItemMoves } from "@/lib/inventory";
import {
  INVENTORY_CATEGORY_COLORS,
  INVENTORY_CATEGORY_ICONS,
  InventoryItem,
  MOVE_KIND_COLORS,
  MOVE_KIND_ICONS,
  STOCK_STATE_COLORS,
  formatPrice,
  formatQty,
  moveDelta,
  stockState,
} from "@/lib/types";
import DeleteItemButton from "./delete-item-button";
import DeleteMoveButton from "../moves/delete-move-button";

// ============================================================
// بطاقة المادة — الرصيد الحالي وسجلّ حركتها كاملاً.
//
// عمود «الرصيد بعدها» هو ما يجعل السجلّ مفهوماً: تقرأ من الأعلى
// للأسفل فترى كيف وصل الرصيد إلى رقمه الحالي، حركةً حركة.
// ============================================================
export default async function ItemPage({ params }: { params: { id: string } }) {
  if (!(await canManageInventory())) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data }, moves] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("*, suppliers(name)")
      .eq("id", params.id)
      .maybeSingle(),
    getItemMoves(params.id),
  ]);

  if (!data) notFound();
  const item = data as InventoryItem;
  const state = stockState(item);

  // الرصيد بعد كل حركة — يُحسب من الأقدم للأحدث ثم يُقرأ بالعكس
  const oldestFirst = [...moves].reverse();
  const balanceAfter = new Map<string, number>();
  let running = 0;
  oldestFirst.forEach((m) => {
    running += moveDelta(m);
    balanceAfter.set(m.id, running);
  });

  const purchased = moves
    .filter((m) => m.kind === "شراء")
    .reduce((s, m) => s + m.quantity, 0);
  const issued = moves
    .filter((m) => m.kind === "صرف")
    .reduce((s, m) => s + m.quantity, 0);
  const spent = moves
    .filter((m) => m.kind === "شراء")
    .reduce((s, m) => s + (m.total_price ?? 0), 0);

  const kpi = "glass-card border-s-4 p-5";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/inventory"
            className="text-sm text-gray-500 hover:text-brand-700"
          >
            ← المخزون
          </Link>
          <div>
            <h1 className="text-xl font-bold text-brand-700">{item.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  INVENTORY_CATEGORY_COLORS[item.category] ?? "bg-gray-100 text-gray-600"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {INVENTORY_CATEGORY_ICONS[item.category] ?? "inventory_2"}
                </span>
                {item.category}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${STOCK_STATE_COLORS[state]}`}
              >
                {state}
              </span>
              {!item.is_active && (
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
                  موقوفة
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/dashboard/inventory/moves/new?item=${item.id}&kind=${encodeURIComponent("شراء")}`}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            تسجيل شراء
          </Link>
          <Link
            href={`/dashboard/inventory/moves/new?item=${item.id}&kind=${encodeURIComponent("صرف")}`}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            تسجيل صرف
          </Link>
          <Link
            href={`/dashboard/inventory/${item.id}/edit`}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
          >
            تعديل
          </Link>
        </div>
      </header>

      <section className="space-y-5 p-6">
        {/* المؤشرات */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className={kpi + " border-s-brand-500"}>
            <span className="text-sm text-gray-500">الرصيد الحالي</span>
            <p className="mt-1 text-2xl font-bold text-gray-800">
              {formatQty(item.quantity)}{" "}
              <span className="text-sm font-normal text-gray-500">{item.unit}</span>
            </p>
            <p className="mt-1 text-xs text-gray-400">
              الحد الأدنى {formatQty(item.min_quantity)} {item.unit}
            </p>
          </div>
          <div className={kpi + " border-s-emerald-500"}>
            <span className="text-sm text-gray-500">إجمالي المشترى</span>
            <p className="mt-1 text-2xl font-bold text-emerald-700">
              {formatQty(purchased)}
            </p>
          </div>
          <div className={kpi + " border-s-red-500"}>
            <span className="text-sm text-gray-500">إجمالي المصروف</span>
            <p className="mt-1 text-2xl font-bold text-red-700">{formatQty(issued)}</p>
          </div>
          <div className={kpi + " border-s-blue-500"}>
            <span className="text-sm text-gray-500">قيمة المشتريات</span>
            <p className="mt-1 text-2xl font-bold text-blue-700" dir="ltr">
              {formatPrice(spent)}
            </p>
          </div>
        </div>

        {/* بيانات المادة */}
        <div className="glass-card p-6">
          <h2 className="mb-4 text-lg font-bold text-gray-800">بيانات المادة</h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "وحدة القياس", value: item.unit },
              { label: "المورد المعتاد", value: item.suppliers?.name ?? "—" },
              { label: "تاريخ آخر شراء", value: item.last_purchase_date ?? "—" },
              {
                label: "سعر آخر شراء",
                value: formatPrice(item.last_purchase_price),
              },
            ].map((f) => (
              <div key={f.label}>
                <dt className="text-xs font-bold uppercase text-gray-400">
                  {f.label}
                </dt>
                <dd className="mt-1 text-gray-800">{f.value}</dd>
              </div>
            ))}
          </dl>
          {item.notes && (
            <p className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
              {item.notes}
            </p>
          )}
        </div>

        {/* سجلّ الحركة */}
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="text-lg font-bold text-gray-800">
              سجلّ الحركة ({moves.length})
            </h2>
          </div>

          {moves.length === 0 ? (
            <p className="p-10 text-center text-gray-500">
              لا توجد حركات بعد. سجّل أول شراء لهذه المادة.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-start text-sm">
                <thead className="border-b bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3 text-start font-medium">التاريخ</th>
                    <th className="px-4 py-3 text-start font-medium">النوع</th>
                    <th className="px-4 py-3 text-start font-medium">الكمية</th>
                    <th className="px-4 py-3 text-start font-medium">الرصيد بعدها</th>
                    <th className="px-4 py-3 text-start font-medium">المورد / صُرف إلى</th>
                    <th className="px-4 py-3 text-start font-medium">القيمة</th>
                    <th className="px-4 py-3 text-start font-medium">بواسطة</th>
                    <th className="px-4 py-3 text-start font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((m) => (
                    <tr key={m.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600" dir="ltr">
                        {m.moved_at}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            MOVE_KIND_COLORS[m.kind] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {MOVE_KIND_ICONS[m.kind] ?? "swap_horiz"}
                          </span>
                          {m.kind}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold" dir="ltr">
                        {moveDelta(m) > 0 ? "+" : "−"}
                        {formatQty(Math.abs(moveDelta(m)))}
                      </td>
                      <td className="px-4 py-3 text-gray-700" dir="ltr">
                        {formatQty(balanceAfter.get(m.id) ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {m.suppliers?.name ?? m.issued_to ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600" dir="ltr">
                        {m.kind === "شراء" ? formatPrice(m.total_price) : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {m.actor_name ?? "—"}
                        {m.notes && (
                          <span className="block text-xs text-gray-400">{m.notes}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <DeleteMoveButton moveId={m.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* الحذف — آخر الصفحة، بعيداً عن الضغط بالخطأ.
            متاح لمن يدير المخزون (المدير ومدير المتابعة) تماماً كما
            تسمح سياسة القاعدة — فلا يظهر زرّ لا يعمل ولا يُخفى حقّ. */}
        <div className="rounded-2xl border border-red-100 bg-red-50/50 p-5">
          <p className="mb-3 text-sm text-gray-600">
            حذف المادة يمسح سجلّ حركتها كاملاً. الأفضل عادةً إيقافها من التعديل.
          </p>
          <DeleteItemButton
            itemId={item.id}
            itemName={item.name}
            movesCount={moves.length}
          />
        </div>
      </section>
    </main>
  );
}
