import { createClient } from "@/lib/supabase/server";

// قوائم العملاء والحجوزات لنموذج الفاتورة
export async function getInvoiceFormOptions() {
  const supabase = await createClient();
  const [{ data: clients }, { data: reservations }] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase
      .from("reservations")
      .select("id, clients(name), units(project, unit_code)")
      .order("created_at", { ascending: false }),
  ]);

  const resList = (reservations ?? []) as unknown as Array<{
    id: string;
    clients: { name: string } | null;
    units: { project: string; unit_code: string | null } | null;
  }>;
  const resOptions = resList.map((r) => ({
    id: r.id,
    label: `${r.clients?.name ?? "عميل"} — ${r.units?.project ?? "وحدة"}${
      r.units?.unit_code ? " " + r.units.unit_code : ""
    }`,
  }));

  return { clients: clients ?? [], reservations: resOptions };
}
