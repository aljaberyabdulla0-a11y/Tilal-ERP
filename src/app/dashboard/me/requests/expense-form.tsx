"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// مصروف عمل — الإيصال إلى دلو خاصّ في مجلّد الموظف، ثم submit_expense (sql/162).
// القاعدة تتحقّق من الفئة والإيصال والمسار، وتُدخله سلسلة «expense».
export default function ExpenseForm({
  employeeId,
  categories,
  projects,
}: {
  employeeId: string;
  categories: { code: string; name_ar: string; requires_receipt: boolean }[];
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: categories[0]?.code ?? "", date: "", amount: "", description: "", project: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    let path: string | null = null;
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setBusy(false);
        return setMsg({ ok: false, text: "الحدّ 10 ميغابايت." });
      }
      path = `expenses/${employeeId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-؀-ۿ ]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("expense-receipts").upload(path, file, { contentType: file.type || undefined });
      if (upErr) {
        setBusy(false);
        return setMsg({ ok: false, text: "تعذّر رفع الإيصال: " + upErr.message });
      }
    }
    const { error } = await supabase.rpc("submit_expense", {
      p_category: f.category, p_date: f.date, p_amount: Number(f.amount), p_description: f.description,
      p_project: f.project || null, p_receipt_path: path, p_receipt_name: file?.name ?? null,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: "أُرسل المصروف إلى سلسلة الموافقة ✓" });
    setOpen(false);
    setFile(null);
    setF({ ...f, date: "", amount: "", description: "" });
    router.refresh();
  }

  const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const needsReceipt = categories.find((c) => c.code === f.category)?.requires_receipt;

  return (
    <div>
      <button onClick={() => setOpen(!open)} className="rounded-lg border px-4 py-2 text-sm text-brand-700 hover:bg-gray-50">
        + مصروف عمل
      </button>
      {msg && <p className={`mt-2 rounded p-2 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      {open && (
        <form onSubmit={submit} className="mt-3 grid grid-cols-1 gap-3 rounded-2xl border bg-white p-5 shadow-sm sm:grid-cols-3">
          <label className="text-xs text-gray-600">
            الفئة
            <select className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {categories.map((c) => <option key={c.code} value={c.code}>{c.name_ar}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">التاريخ *<input className={input} type="date" dir="ltr" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="text-xs text-gray-600">المبلغ (د.ع) *<input className={input} type="number" min="1" dir="ltr" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          <label className="text-xs text-gray-600 sm:col-span-2">البيان *<input className={input} required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <label className="text-xs text-gray-600">
            المشروع
            <select className={input} value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}>
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600 sm:col-span-3">
            الإيصال {needsReceipt && <span className="text-red-500">*</span>}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" required={needsReceipt}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block text-xs" />
          </label>
          <button disabled={busy} className="rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-3">
            {busy ? "يرسل…" : "إرسال — المدير ثم المالية"}
          </button>
        </form>
      )}
    </div>
  );
}
