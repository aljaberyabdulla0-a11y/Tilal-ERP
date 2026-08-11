"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Reservation, RESERVATION_STATUSES } from "@/lib/types";

// خيارات القوائم المنسدلة (تأتي من صفحة الخادم)
type ClientOption = { id: string; name: string };
type UnitOption = {
  id: string;
  project: string;
  unit_code: string | null;
  status: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// نموذج مشترك لإضافة/تعديل حجز
export default function ReservationForm({
  clients,
  units,
  initial,
  reservationId,
}: {
  clients: ClientOption[];
  units: UnitOption[];
  initial?: Partial<Reservation>;
  reservationId?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = Boolean(reservationId);

  const [form, setForm] = useState({
    client_id: initial?.client_id ?? "",
    unit_id: initial?.unit_id ?? "",
    reservation_date: initial?.reservation_date ?? today(),
    status: initial?.status ?? "حجز",
    amount: initial?.amount?.toString() ?? "",
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
      unit_id: form.unit_id,
      reservation_date: form.reservation_date || null,
      status: form.status,
      amount: form.amount ? Number(form.amount) : null,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    const { error } = isEdit
      ? await supabase.from("reservations").update(payload).eq("id", reservationId!)
      : await supabase.from("reservations").insert(payload);
    setSaving(false);

    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }

    router.push(
      isEdit ? `/dashboard/reservations/${reservationId}` : "/dashboard/reservations"
    );
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
      {/* تنبيه إن لم يوجد عملاء أو وحدات */}
      {(clients.length === 0 || units.length === 0) && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          تحتاج إلى وجود عميل واحد ووحدة واحدة على الأقل قبل إنشاء حجز.
          {clients.length === 0 && " (لا يوجد عملاء)"}
          {units.length === 0 && " (لا توجد وحدات)"}
        </p>
      )}

      {/* العميل */}
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

      {/* الوحدة */}
      <div>
        <label className={labelClass}>الوحدة العقارية {req}</label>
        <select
          required
          value={form.unit_id}
          onChange={(e) => update("unit_id", e.target.value)}
          className={inputClass}
        >
          <option value="">— اختر الوحدة —</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.project}
              {u.unit_code ? ` - ${u.unit_code}` : ""} ({u.status})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* تاريخ الحجز */}
        <div>
          <label className={labelClass}>تاريخ الحجز {req}</label>
          <input
            type="date"
            required
            dir="ltr"
            value={form.reservation_date}
            onChange={(e) => update("reservation_date", e.target.value)}
            className={inputClass + " text-start"}
          />
        </div>

        {/* الحالة */}
        <div>
          <label className={labelClass}>حالة الحجز {req}</label>
          <select
            required
            value={form.status}
            onChange={(e) => update("status", e.target.value)}
            className={inputClass}
          >
            {RESERVATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* المبلغ */}
        <div className="sm:col-span-2">
          <label className={labelClass}>المبلغ المدفوع (دينار عراقي)</label>
          <input
            type="number"
            min="0"
            step="any"
            dir="ltr"
            value={form.amount}
            onChange={(e) => update("amount", e.target.value)}
            className={inputClass + " text-start"}
            placeholder="مثال: 25000000"
          />
        </div>

        {/* ملاحظات */}
        <div className="sm:col-span-2">
          <label className={labelClass}>ملاحظات</label>
          <textarea
            rows={4}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            className={inputClass}
            placeholder="أي تفاصيل إضافية عن الحجز..."
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
          {saving ? "جاري الحفظ..." : isEdit ? "حفظ التعديلات" : "حفظ الحجز"}
        </button>
        <Link
          href={
            isEdit
              ? `/dashboard/reservations/${reservationId}`
              : "/dashboard/reservations"
          }
          className="rounded-lg border border-gray-300 px-6 py-2.5 font-medium text-gray-700 transition hover:bg-gray-100"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
