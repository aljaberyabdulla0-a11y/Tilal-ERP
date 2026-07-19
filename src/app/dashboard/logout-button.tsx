"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// زر تسجيل الخروج — ينهي الجلسة ويعيد المستخدم لصفحة الدخول
export default function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className={
        className ??
        "rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-700 transition hover:bg-gray-100"
      }
    >
      تسجيل الخروج
    </button>
  );
}
