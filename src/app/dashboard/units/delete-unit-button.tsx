"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// زر حذف وحدة عقارية — يطلب تأكيداً ثم يحدّث القائمة
export default function DeleteUnitButton({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const ok = window.confirm(`هل أنت متأكد من حذف الوحدة "${label}"؟`);
    if (!ok) return;

    setDeleting(true);
    const { error } = await supabase.from("units").delete().eq("id", id);
    setDeleting(false);

    if (error) {
      alert("تعذّر الحذف: " + error.message);
      return;
    }
    router.refresh();
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-sm text-red-600 transition hover:text-red-800 disabled:opacity-50"
    >
      {deleting ? "..." : "حذف"}
    </button>
  );
}
