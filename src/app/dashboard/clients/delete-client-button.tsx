"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// زر حذف عميل — يطلب تأكيداً قبل الحذف ثم يحدّث القائمة
export default function DeleteClientButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const ok = window.confirm(`هل أنت متأكد من حذف العميل "${name}"؟`);
    if (!ok) return;

    setDeleting(true);
    const { error } = await supabase.from("clients").delete().eq("id", id);
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
