import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageInventory } from "@/lib/auth";
import { getSuppliers } from "@/lib/inventory";
import InventoryTabs from "../inventory-tabs";
import SuppliersManager from "./suppliers-manager";

// الموردون — من أين نشتري كل مادة، وكم عملية شراء سُجّلت لكلٍّ منهم
export default async function SuppliersPage() {
  if (!(await canManageInventory())) redirect("/dashboard");

  const supabase = await createClient();
  const [suppliers, { data: moves }] = await Promise.all([
    getSuppliers(),
    supabase.from("inventory_moves").select("supplier_id").eq("kind", "شراء"),
  ]);

  // عدد المشتريات لكل مورد — يجعل الحذف قراراً مبنياً على معرفة
  const usage: Record<string, number> = {};
  (moves ?? []).forEach((m: { supplier_id: string | null }) => {
    if (m.supplier_id) usage[m.supplier_id] = (usage[m.supplier_id] ?? 0) + 1;
  });

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">المخزون</h1>
      </header>

      <InventoryTabs active="suppliers" />

      <section className="p-6">
        <SuppliersManager suppliers={suppliers} usage={usage} />
      </section>
    </main>
  );
}
