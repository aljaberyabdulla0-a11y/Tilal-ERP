"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// حذف حركة خاطئة — يعيد المحفّز حساب رصيد المادة فوراً بعده.
// سياسة القاعدة تسمح لصاحب الحركة وللمدير فقط، فقد يرفض الحذف
// لغيرهما ونعرض السبب كما جاء بدل ابتلاعه.
export default function DeleteMoveButton({ moveId }: { moveId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm("حذف هذه الحركة؟ سيتغيّر رصيد المادة تبعاً لذلك.")) return;

    setBusy(true);
    setError(null);
    const { error, count } = await supabase
      .from("inventory_moves")
      .delete({ count: "exact" })
      .eq("id", moveId);
    setBusy(false);

    if (error) {
      setError("تعذّر الحذف: " + error.message);
      return;
    }
    if (!count) {
      // لا خطأ ولا صفّ محذوف = سياسة القاعدة منعت الحذف بصمت
      setError("لا تملك صلاحية حذف حركة سجّلها غيرك.");
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        onClick={remove}
        disabled={busy}
        className="text-xs font-medium text-red-600 transition hover:underline disabled:opacity-50"
      >
        {busy ? "..." : "حذف"}
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </span>
  );
}
