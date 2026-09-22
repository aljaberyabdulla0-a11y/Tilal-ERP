import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppNotification } from "@/lib/types";
import NotificationList from "./notification-list";

// كل إشعاراتي
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: { category?: string };
}) {
  const supabase = await createClient();
  const category = (searchParams.category ?? "").trim() || null;
  let q = supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (category) q = q.eq("category", category);
  const { data } = await q;

  const items = (data ?? []) as AppNotification[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard" className="text-sm text-gray-500 hover:text-brand-700">
          ← لوحة التحكم
        </Link>
        <h1 className="text-xl font-bold text-brand-700">الإشعارات</h1>
      </header>

      <section className="p-6">
        <NotificationList items={items} category={category} />
      </section>
    </main>
  );
}
