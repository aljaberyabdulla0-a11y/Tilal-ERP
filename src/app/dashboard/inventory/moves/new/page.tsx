import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageInventory } from "@/lib/auth";
import { getInventoryItems, getSuppliers } from "@/lib/inventory";
import MoveForm from "../../move-form";

// تسجيل حركة مخزون — تُفتح من زرّي «شراء» و«صرف» في قائمة المواد
// أو من الزر العام أعلى القسم.
export default async function NewMovePage({
  searchParams,
}: {
  searchParams: { item?: string; kind?: string };
}) {
  if (!(await canManageInventory())) redirect("/dashboard");

  const [items, suppliers] = await Promise.all([
    getInventoryItems(),
    getSuppliers(),
  ]);

  const fixed = searchParams.item
    ? items.find((i) => i.id === searchParams.item)
    : undefined;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/inventory"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← المخزون
        </Link>
        <h1 className="text-xl font-bold text-brand-700">
          تسجيل حركة{fixed ? ` — ${fixed.name}` : ""}
        </h1>
      </header>

      <section className="p-6">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            أضف مادة أولاً، ثم سجّل عليها الشراء والصرف.{" "}
            <Link href="/dashboard/inventory/new" className="font-semibold underline">
              إضافة مادة
            </Link>
          </div>
        ) : (
          <MoveForm
            items={items}
            fixedItem={fixed}
            defaultKind={searchParams.kind}
            suppliers={suppliers}
          />
        )}
      </section>
    </main>
  );
}
