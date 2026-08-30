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
