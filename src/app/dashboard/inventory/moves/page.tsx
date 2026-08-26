import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageInventory } from "@/lib/auth";
import { getInventoryItems } from "@/lib/inventory";
import {
  InventoryMove,
  MOVE_KINDS,
  MOVE_KIND_COLORS,
  MOVE_KIND_ICONS,
  formatPrice,
  formatQty,
  moveDelta,
} from "@/lib/types";
import InventoryTabs from "../inventory-tabs";
import DeleteMoveButton from "./delete-move-button";

const PERIODS = [
  { key: "7", label: "آخر ٧ أيام" },
  { key: "30", label: "آخر ٣٠ يوم" },
  { key: "90", label: "آخر ٣ أشهر" },
  { key: "all", label: "كل الفترات" },
];

// أول يوم في فترة الفلتر (بتوقيت بغداد) بصيغة YYYY-MM-DD
function periodStart(days: number): string {
  const d = new Date(Date.now() - days * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" });
}

// ============================================================
// سجلّ حركة المخزون — كل شراء وكل صرف في مكان واحد، مع فلاتر.
// هنا يُجاب سؤال «أين ذهبت المواد؟» و«كم أنفقنا هذا الشهر؟».
// ============================================================
export default async function MovesPage({
  searchParams,
}: {
  searchParams: { kind?: string; item?: string; period?: string };
}) {
  if (!(await canManageInventory())) redirect("/dashboard");

  const supabase = await createClient();
  const kind = searchParams.kind ?? "";
  const itemId = searchParams.item ?? "";
  const period = searchParams.period ?? "30";

  let query = supabase
    .from("inventory_moves")
    .select("*, inventory_items(name, unit, category), suppliers(name)")
    .order("moved_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);

  if (kind) query = query.eq("kind", kind);
  if (itemId) query = query.eq("item_id", itemId);
  if (period !== "all") query = query.gte("moved_at", periodStart(Number(period) || 30));

  const [{ data }, items] = await Promise.all([query, getInventoryItems()]);
  const moves = (data ?? []) as InventoryMove[];

  const purchases = moves.filter((m) => m.kind === "شراء");
  const issues = moves.filter((m) => m.kind === "صرف");
  const spent = purchases.reduce((s, m) => s + (m.total_price ?? 0), 0);

  const inputCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const kpi = "glass-card border-s-4 p-5";

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
            ← لوحة التحكم
          </Link>
          <h1 className="text-xl font-bold text-brand-700">المخزون</h1>
        </div>
        <Link
          href="/dashboard/inventory/moves/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          + تسجيل حركة
        </Link>
      </header>

      <InventoryTabs active="moves" />

      <section className="space-y-5 p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className={kpi + " border-s-emerald-500"}>
            <span className="text-sm text-gray-500">عمليات شراء</span>
            <p className="mt-1 text-2xl font-bold text-emerald-700">{purchases.length}</p>
          </div>
          <div className={kpi + " border-s-red-500"}>
            <span className="text-sm text-gray-500">عمليات صرف</span>
            <p className="mt-1 text-2xl font-bold text-red-700">{issues.length}</p>
          </div>
          <div className={kpi + " border-s-blue-500"}>
            <span className="text-sm text-gray-500">قيمة المشتريات</span>
            <p className="mt-1 text-2xl font-bold text-blue-700" dir="ltr">
              {formatPrice(spent)}
            </p>
          </div>
        </div>

        <form className="flex flex-wrap gap-2">
          <select name="kind" defaultValue={kind} className={inputCls}>
            <option value="">كل الأنواع</option>
            {MOVE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <select name="item" defaultValue={itemId} className={inputCls}>
            <option value="">كل المواد</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
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

        {moves.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            لا توجد حركات في هذه الفترة.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
            <table className="w-full min-w-[950px] text-start text-sm">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">التاريخ</th>
                  <th className="px-4 py-3 text-start font-medium">المادة</th>
                  <th className="px-4 py-3 text-start font-medium">النوع</th>
                  <th className="px-4 py-3 text-start font-medium">الكمية</th>
                  <th className="px-4 py-3 text-start font-medium">سعر الوحدة</th>
                  <th className="px-4 py-3 text-start font-medium">القيمة</th>
                  <th className="px-4 py-3 text-start font-medium">المورد / صُرف إلى</th>
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
                      <Link
                        href={`/dashboard/inventory/${m.item_id}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {m.inventory_items?.name ?? "—"}
                      </Link>
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
                      {formatQty(Math.abs(moveDelta(m)))}{" "}
                      <span className="text-xs font-normal text-gray-400">
                        {m.inventory_items?.unit ?? ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">
                      {m.kind === "شراء" ? formatPrice(m.unit_price) : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700" dir="ltr">
                      {m.kind === "شراء" ? formatPrice(m.total_price) : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {m.suppliers?.name ?? m.issued_to ?? "—"}
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
      </section>
    </main>
  );
}
