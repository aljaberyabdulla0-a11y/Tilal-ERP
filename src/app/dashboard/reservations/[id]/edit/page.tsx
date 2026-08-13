import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canSeeTeam, isAdmin } from "@/lib/auth";
import { Reservation } from "@/lib/types";
import ReservationForm from "../../reservation-form";

// صفحة تعديل حجز — للمدير فقط
export default async function EditReservationPage({
  params,
}: {
  params: { id: string };
}) {
  if (!(await canSeeTeam())) {
    redirect(`/dashboard/reservations/${params.id}`);
  }

  const supabase = await createClient();

  const [{ data: reservation }, { data: clients }, { data: units }] =
    await Promise.all([
      supabase.from("reservations").select("*").eq("id", params.id).single(),
      supabase.from("clients").select("id, name").order("name"),
      supabase
        .from("units")
        .select("id, project, unit_code, status")
        .order("project"),
    ]);

  if (!reservation) notFound();
  const res = reservation as Reservation;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link
          href={`/dashboard/reservations/${res.id}`}
          className="text-sm text-gray-500 hover:text-brand-700"
        >
          ← تفاصيل الحجز
        </Link>
        <h1 className="text-xl font-bold text-brand-700">تعديل الحجز</h1>
      </header>

      <section className="p-6">
        <ReservationForm
          clients={clients ?? []}
          units={units ?? []}
          initial={res}
          reservationId={res.id}
        />
      </section>
    </main>
  );
}
