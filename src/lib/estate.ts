import { createClient } from "@/lib/supabase/server";
import {
  Invoice,
  Payment,
  Project,
  ProjectNode,
  Reservation,
  Unit,
  UnitEvent,
  UnitFinance,
  UnitTypeRow,
} from "@/lib/types";

// ============================================================
// مخزون المشاريع العقارية — قراءة البيانات.
//
// ⚠️ لا تصفية بالأدوار هنا: سياسات القاعدة (sql/044) هي التي تقرّر
// من يرى ماذا. لو صفّينا هنا أيضاً لصار للحقيقة مصدران، وسبق أن
// اختلفا في أنظمة كثيرة — يبقى المصدر واحداً.
// ============================================================

export async function getProject(id: string): Promise<Project | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  return (data as Project) ?? null;
}

export async function getProjectNodes(projectId: string): Promise<ProjectNode[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_nodes")
    .select("*")
    .eq("project_id", projectId)
    .order("depth")
    .order("sort_order");
  return (data ?? []) as ProjectNode[];
}

export async function getUnitTypes(): Promise<UnitTypeRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("unit_types")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  return (data ?? []) as UnitTypeRow[];
}

export async function getProjectUnits(projectId: string): Promise<Unit[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("units")
    .select("*")
    .eq("project_id", projectId)
    .order("node_path", { nullsFirst: false })
    .order("unit_code");
  return (data ?? []) as Unit[];
}

// ============================================================
// عدّاد المخزون لكل مشروع — لبطاقات قائمة المشاريع.
//
// استعلامٌ واحد بعمودين لا استعلام لكل مشروع: الصفوف التي تعود
// هي وحدات نطاق المستخدم وحدها (RLS)، والعدّ في الذاكرة أرخص من
// عشر رحلات شبكة تعود كل واحدة برقم.
// ============================================================
export type ProjectStock = {
  total: number;
  available: number;
  reserved: number;
  sold: number;
};

export async function getProjectStock(): Promise<Map<string, ProjectStock>> {
  const supabase = await createClient();
  const { data } = await supabase.from("units").select("project_id, status");

  const map = new Map<string, ProjectStock>();
  for (const row of (data ?? []) as { project_id: string | null; status: string }[]) {
    if (!row.project_id) continue;
    const s =
      map.get(row.project_id) ??
      { total: 0, available: 0, reserved: 0, sold: 0 };
    s.total++;
    if (row.status === "متاحة") s.available++;
    else if (row.status === "محجوزة") s.reserved++;
    else if (row.status === "مباعة") s.sold++;
    map.set(row.project_id, s);
  }
  return map;
}

export async function getUnit(id: string): Promise<Unit | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("units").select("*").eq("id", id).maybeSingle();
  return (data as Unit) ?? null;
}

export async function getUnitEvents(unitId: string): Promise<UnitEvent[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("unit_events")
    .select("*")
    .eq("unit_id", unitId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as UnitEvent[];
}

// الوضع المالي — منظور محسوب لا عمود مخزَّن، فلا يكذب بعد تعديل
// فاتورة أو حذف دفعة (sql/044).
export async function getUnitFinance(unitId: string): Promise<UnitFinance | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("unit_finance")
    .select("*")
    .eq("unit_id", unitId)
    .maybeSingle();
  return (data as UnitFinance) ?? null;
}

export async function getUnitReservations(unitId: string): Promise<Reservation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reservations")
    .select("*, clients(name)")
    .eq("unit_id", unitId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Reservation[];
}

// الحجوزات القائمة في مشروع واحد — منها تُبنى «صفقاتي» للموظف
// و«طلبات بانتظار قرارك» للإدارة. الربط inner لأن الحجز بلا
// وحدة لا معنى له هنا.
export async function getProjectHeldReservations(
  projectId: string
): Promise<Reservation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reservations")
    .select("*, clients(name), units!inner(project, project_id, unit_code)")
    .eq("units.project_id", projectId)
    .eq("status", "حجز")
    .order("created_at", { ascending: false });
  return (data ?? []) as Reservation[];
}

export async function getUnitInvoices(unitId: string): Promise<Invoice[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("*, clients(name), payments(amount)")
    .eq("unit_id", unitId)
    .order("issue_date", { ascending: false });
  return (data ?? []) as Invoice[];
}

export async function getUnitPayments(unitId: string): Promise<(Payment & { invoice_number?: string })[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("*, invoices!inner(invoice_number, unit_id)")
    .eq("invoices.unit_id", unitId)
    .order("payment_date", { ascending: false });

  return (data ?? []).map((p) => {
    const row = p as Payment & { invoices?: { invoice_number: string } };
    return { ...row, invoice_number: row.invoices?.invoice_number };
  });
}
