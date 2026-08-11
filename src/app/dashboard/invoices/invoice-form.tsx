"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Invoice } from "@/lib/types";

type ClientOption = { id: string; name: string };
type ReservationOption = {
  id: string;
  label: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// نموذج مشترك لإضافة/تعديل فاتورة
export default function InvoiceForm({
  clients,
  reservations,
  initial,
  invoiceId,
}: {
  clients: ClientOption[];
  reservations: ReservationOption[];
  initial?: Partial<Invoice>;
  invoiceId?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = Boolean(invoiceId);

  const [form, setForm] = useState({
    client_id: initial?.client_id ?? "",
    reservation_id: initial?.reservation_id ?? "",
    issue_date: initial?.issue_date ?? today(),
    due_date: initial?.due_date ?? "",
    total_amount: initial?.total_amount?.toString() ?? "",
    notes: initial?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = {
      client_id: form.client_id,
      reservation_id: form.reservation_id || null,
      issue_date: form.issue_date || null,
      due_date: form.due_date || null,
      total_amount: form.total_amount ? Number(form.total_amount) : 0,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    const { error } = isEdit
      ? await supabase.from("invoices").update(payload).eq("id", invoiceId!)
      : await supabase.from("invoices").insert(payload);
    setSaving(false);

    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }
    router.push(isEdit ? `/dashboard/invoices/${invoiceId}` : "/dashboard/invoices");
    router.refresh();
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const labelClass = "mb-1 block text-sm font-medium text-gray-700";
  const req = <span className="text-red-500">*</span>;

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-2xl space-y-5 rounded-2xl bg-white p-8 shadow-sm"
    >
      {clients.length === 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          لا يوجد عملاء بعد. أضف عميلاً أولاً قبل إنشاء فاتورة.
        </p>
      )}

      <div>
        <label className={labelClass}>العميل {req}</label>
        <select
          required
          value={form.client_id}
          onChange={(e) => update("client_id", e.target.value)}
          className={inputClass}
        >
          <option value="">— اختر العميل —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>مرتبطة بحجز (اختياري)</label>
        <select
          value={form.reservation_id}
          onChange={(e) => update("reservation_id", e.target.value)}
          className={inputClass}
        >
          <option value="">— بدون ربط —</option>
          {reservations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label className={labelClass}>تاريخ الإصدار {req}</label>
          <input
            type="date"
            required
            dir="ltr"
            value={form.issue_date}
            onChange={(e) => update("issue_date", e.target.value)}
            className={inputClass + " text-start"}
          />
        </div>
        <div>
          <label className={labelClass}>تاريخ الاستحقاق</label>
          <input
            type="date"
            dir="ltr"
            value={form.due_date}
            onChange={(e) => update("due_date", e.target.value)}
            className={inputClass + " text-start"}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>المبلغ الإجمالي (دينار عراقي) {req}</label>
          <input
            type="number"
            required
            min="0"
            step="any"
            dir="ltr"
            value={form.total_amount}
            onChange={(e) => update("total_amount", e.target.value)}
            className={inputClass + " text-start"}
            placeholder="مثال: 50000000"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>ملاحظات</label>
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            className={inputClass}
            placeholder="بيان الفاتورة أو أي تفاصيل..."
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جاري الحفظ..." : isEdit ? "حفظ التعديلات" : "حفظ الفاتورة"}
        </button>
        <Link
          href="/dashboard/invoices"
          className="rounded-lg border border-gray-300 px-6 py-2.5 font-medium text-gray-700 transition hover:bg-gray-100"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
