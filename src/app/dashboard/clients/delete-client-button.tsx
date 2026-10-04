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
      // 23503: للعميل صفقة لها تحليل خسارة (140) — سجلّ مبيعات لا يُمحى حذفاً صلباً
      alert(
        error.code === "23503"
          ? "للعميل سجلّ مبيعات (تحليل خسارة) لا يُمحى. استعمل الحذف الناعم من لوحة جودة البيانات — يُخفي العميل ويُبقي تاريخه."
          : "تعذّر الحذف: " + error.message
      );
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
