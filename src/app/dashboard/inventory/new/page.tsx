import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageInventory } from "@/lib/auth";
import { getSuppliers } from "@/lib/inventory";
import ItemForm from "../item-form";

// إضافة مادة جديدة للمخزون
export default async function NewItemPage() {
  if (!(await canManageInventory())) redirect("/dashboard");

  const suppliers = await getSuppliers();

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/inventory"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← المخزون
        </Link>
        <h1 className="text-xl font-bold text-brand-700">مادة جديدة</h1>
      </header>

      <section className="p-6">
        <ItemForm suppliers={suppliers} />
      </section>
    </main>
  );
}
