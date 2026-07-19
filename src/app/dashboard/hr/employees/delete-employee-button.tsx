"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// زر حذف موظف (تُحذف بياناته المرتبطة تلقائياً عبر cascade)
export default function DeleteEmployeeButton({
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
    if (!window.confirm(`حذف الموظف "${name}" وكل بياناته (حضور/إجازات/عمولات...)؟`))
      return;
    setDeleting(true);
    const { error } = await supabase.from("employees").delete().eq("id", id);
    setDeleting(false);
    if (error) {
      alert("تعذّر الحذف: " + error.message);
      return;
    }
    router.push("/dashboard/hr/employees");
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
