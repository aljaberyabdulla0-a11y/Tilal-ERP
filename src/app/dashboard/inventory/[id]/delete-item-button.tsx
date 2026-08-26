"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// حذف مادة — يحذف معها كل سجلّ حركتها (on delete cascade)،
// لذلك نصارح المستخدم بعدد الحركات قبل السؤال.
export default function DeleteItemButton({
  itemId,
  itemName,
  movesCount,
}: {
  itemId: string;
  itemName: string;
  movesCount: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (
      !confirm(
        movesCount > 0
          ? `حذف «${itemName}»؟ سيُحذف معها ${movesCount} حركة من السجلّ ولا يمكن التراجع.\n\nإن كنت تريد إيقافها فقط فعدّلها وأزل علامة «مادة فعّالة».`
          : `حذف «${itemName}»؟`
      )
    )
      return;

    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("inventory_items")
      .delete()
      .eq("id", itemId);

    if (error) {
      setBusy(false);
      setError("تعذّر الحذف: " + error.message);
      return;
    }

    router.push("/dashboard/inventory");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={remove}
        disabled={busy}
        className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
      >
        {busy ? "جارٍ الحذف..." : "حذف المادة"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
