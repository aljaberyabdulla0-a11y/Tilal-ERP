"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { baghdadDate } from "@/lib/time";

// عكس قيد يدوي بقيدٍ مقابل (reverse_journal_entry — sql/111). الأصل يبقى،
// والعاكس يحمل تاريخ اليوم: التصحيح يقع في الفترة المفتوحة لا الماضية.
export default function ReverseEntryButton({ id }: { id: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(baghdadDate());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reverse() {
    setError(null);
    if (!reason.trim()) return setError("اكتب سبب العكس.");
    setSaving(true);
    const { data, error } = await supabase.rpc("reverse_journal_entry", {
      p_id: id,
      p_date: date,
      p_reason: reason.trim(),
    });
    setSaving(false);
    if (error) return setError(error.message);
    router.push(`/dashboard/accounting/entries/${data}`);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-800 transition hover:bg-amber-50"
      >
        عكس القيد
      </button>
    );
  }

  const cls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-gray-800">عكس القيد</h3>
        <p className="mt-1 text-sm text-gray-500">
          يُكتب قيدٌ مقابل: كل مدين يصير دائناً وكل دائن مديناً. القيد الأصلي يبقى في الدفتر،
          ولا يُعكس مرّتين.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">تاريخ العكس</label>
            <input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} className={cls + " w-full"} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">السبب</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={cls + " w-full"} placeholder="لماذا يُعكس هذا القيد؟" />
          </div>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button
            onClick={reverse}
            disabled={saving}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
          >
            {saving ? "..." : "اعكس"}
          </button>
          <button onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
