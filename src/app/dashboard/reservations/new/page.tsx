import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ReservationForm from "../reservation-form";

// صفحة إضافة حجز — تجلب قوائم العملاء والوحدات للاختيار منها
export default async function NewReservationPage() {
  const supabase = await createClient();

  const [{ data: clients }, { data: units }] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("units").select("id, project, unit_code, status").order("project"),
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href="/dashboard/reservations"
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← الحجوزات
        </Link>
        <h1 className="text-xl font-bold text-brand-700">حجز جديد</h1>
      </header>

      <section className="p-6">
        <ReservationForm clients={clients ?? []} units={units ?? []} />
      </section>
    </main>
  );
}
