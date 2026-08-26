import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  InventoryItem,
  InventoryMove,
  Supplier,
  stockState,
} from "@/lib/types";

// ============================================================
// المخزون — جلب المواد والحركات والموردين.
//
// ⚠️ لا فلترة بالدور هنا عمداً — نفس مبدأ src/lib/projects.ts:
// سياسات RLS في القاعدة (sql/040) هي التي تُغلق القسم على المدير
// ومدير المتابعة. لو أضفنا الشرط في الشيفرة أيضاً لصار عندنا
// مصدرا حقيقة، وأحدهما سينسى يوماً.
// ============================================================

export const getInventoryItems = cache(async (): Promise<InventoryItem[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("inventory_items")
    .select("*, suppliers(name)")
    .order("category")
    .order("name");
  return (data ?? []) as InventoryItem[];
});

export const getSuppliers = cache(async (): Promise<Supplier[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("suppliers").select("*").order("name");
  return (data ?? []) as Supplier[];
});

// آخر الحركات — للوحة المتابعة وصفحة السجلّ
export async function getRecentMoves(limit = 10): Promise<InventoryMove[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("inventory_moves")
    .select("*, inventory_items(name, unit, category), suppliers(name)")
    .order("moved_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as InventoryMove[];
}

// حركات مادة واحدة — سجلّها الكامل من الأحدث للأقدم
export async function getItemMoves(itemId: string): Promise<InventoryMove[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("inventory_moves")
    .select("*, suppliers(name)")
    .eq("item_id", itemId)
    .order("moved_at", { ascending: false })
    .order("created_at", { ascending: false });
  return (data ?? []) as InventoryMove[];
}

// ============================================================
// خلاصات محسوبة — دوال خالصة تعمل على ما جُلب، بلا استعلام إضافي
// ============================================================

// المواد التي أوشكت على النفاد: النافدة أولاً ثم المنخفضة ثم القريبة.
// هذا ترتيب الإلحاح — أول ما يجب أن تراه الإدارة.
export function lowStockItems(items: InventoryItem[]): InventoryItem[] {
  const rank: Record<string, number> = { "نفدت": 0, "منخفضة": 1, "قريبة": 2 };
  return items
    .filter((i) => i.is_active && stockState(i) !== "جيدة")
    .sort((a, b) => {
      const r = rank[stockState(a)] - rank[stockState(b)];
      if (r !== 0) return r;
      return a.name.localeCompare(b.name, "ar");
    });
}

export type InventorySummary = {
  items: number;       // المواد الفعّالة
  low: number;         // تحت الحد الأدنى أو نفدت
  out: number;         // نفدت تماماً
  categories: number;  // التصنيفات المستخدمة
};

export function summarize(items: InventoryItem[]): InventorySummary {
  const active = items.filter((i) => i.is_active);
  return {
    items: active.length,
    low: active.filter((i) => {
      const s = stockState(i);
      return s === "نفدت" || s === "منخفضة";
    }).length,
    out: active.filter((i) => stockState(i) === "نفدت").length,
    categories: new Set(active.map((i) => i.category)).size,
  };
}

// قيمة المشتريات خلال فترة (من حركات الشراء وحدها)
export function purchasesValue(moves: InventoryMove[]): number {
  return moves
    .filter((m) => m.kind === "شراء")
    .reduce((s, m) => s + (m.total_price ?? 0), 0);
}
