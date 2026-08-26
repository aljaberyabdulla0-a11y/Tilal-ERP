import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageInventory } from "@/lib/auth";
import { getSuppliers } from "@/lib/inventory";
import { InventoryItem } from "@/lib/types";
import ItemForm from "../../item-form";

// تعديل بيانات مادة (لا الرصيد — الرصيد من الحركات)
export default async function EditItemPage({
  params,
}: {
  params: { id: string };
}) {
  if (!(await canManageInventory())) redirect("/dashboard");

  const supabase = await createClient();
  const [{ data }, suppliers] = await Promise.all([
    supabase.from("inventory_items").select("*").eq("id", params.id).maybeSingle(),
    getSuppliers(),
  ]);

  if (!data) notFound();
  const item = data as InventoryItem;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href={`/dashboard/inventory/${item.id}`}
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← {item.name}
        </Link>
        <h1 className="text-xl font-bold text-brand-700">تعديل المادة</h1>
      </header>

      <section className="p-6">
        <ItemForm initial={item} itemId={item.id} suppliers={suppliers} />
      </section>
    </main>
  );
}
