"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEBT_PERSON_KINDS } from "@/lib/types";
import { baghdadDate } from "@/lib/time";

const cls =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

// ============================================================
// تسجيل دين خارجي: فلوس نعطيها لشخص نشتغل وياه على أساس أنها تُرجَع.
// القاعدة تُرحّلها تلقائياً: تنقص من الصندوق وتُقيَّد في ذمّة الشخص —
// ولا تُحسب مصروفاً فلا تنقص أرباح الشركة.
// ============================================================
export default function AddDebt() {
  const router = useRouter();
  const supabase = createClient();
  const today = baghdadDate();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    person_name: "",
    person_phone: "",
    person_kind: DEBT_PERSON_KINDS[0] as string,
    amount: "",
    debt_date: today,
    due_date: "",
    method: "نقد",
    reason: "",
  });

  function update(f: keyof typeof form, v: string) {
    setForm((p) => ({ ...p, [f]: v }));
  }

  async function save() {
    setError(null);
    if (!form.person_name.trim()) {
      setError("اكتب اسم الشخص أو الجهة.");
      return;
    }
    if (!Number(form.amount) || Number(form.amount) <= 0) {
      setError("اكتب مبلغاً أكبر من صفر.");
      return;
    }
    if (form.due_date && form.due_date < form.debt_date) {
      setError("موعد الاستحصال يجب أن يكون بعد تاريخ إعطاء المبلغ.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("external_debts").insert({
      person_name: form.person_name.trim(),
      person_phone: form.person_phone.trim() || null,
      person_kind: form.person_kind,
      amount: Number(form.amount),
      debt_date: form.debt_date,
      due_date: form.due_date || null,
      method: form.method,
      reason: form.reason.trim() || null,
    });
    setSaving(false);

    if (error) {
      setError("تعذّر الحفظ: " + error.message);
      return;
    }
    setForm({ ...form, person_name: "", person_phone: "", amount: "", reason: "", due_date: "" });
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
      >
        + سجّل دَين جديد
      </button>
    );
  }

  return (
    <div className="glass-card w-full p-5">
      <h3 className="mb-1 text-lg font-bold text-gray-800">دَين جديد</h3>
      <p className="mb-4 text-sm text-gray-500">
        المبلغ يخرج من الصندوق أو البنك ويُسجَّل في ذمّة الشخص — لا يُحتسب مصروفاً.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">الاسم *</label>
          <input
            value={form.person_name}
            onChange={(e) => update("person_name", e.target.value)}
            placeholder="اسم الشخص أو الجهة"
            className={cls + " w-full"}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">الصفة</label>
          <select
            value={form.person_kind}
            onChange={(e) => update("person_kind", e.target.value)}
            className={cls + " w-full"}
          >
            {DEBT_PERSON_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">الهاتف</label>
          <input
            value={form.person_phone}
            onChange={(e) => update("person_phone", e.target.value)}
            dir="ltr"
            placeholder="07XXXXXXXXX"
            className={cls + " w-full text-left"}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">المبلغ *</label>
          <input
            type="number"
            min="0"
            dir="ltr"
            value={form.amount}
            onChange={(e) => update("amount", e.target.value)}
            placeholder="0"
            className={cls + " w-full text-left"}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">من أين خرج المبلغ</label>
          <select
            value={form.method}
            onChange={(e) => update("method", e.target.value)}
            className={cls + " w-full"}
          >
            <option value="نقد">الصندوق (نقد)</option>
            <option value="بنك">البنك</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">تاريخ الإعطاء</label>
          <input
            type="date"
            dir="ltr"
            value={form.debt_date}
            onChange={(e) => update("debt_date", e.target.value)}
            className={cls + " w-full text-left"}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">
            موعد الاستحصال <span className="text-gray-400">(اختياري)</span>
          </label>
          <input
            type="date"
            dir="ltr"
            value={form.due_date}
            onChange={(e) => update("due_date", e.target.value)}
            className={cls + " w-full text-left"}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-gray-500">على شنو انعطت</label>
          <input
            value={form.reason}
            onChange={(e) => update("reason", e.target.value)}
            placeholder="مثلاً: سلفة على أعمال تشطيب"
            className={cls + " w-full"}
          />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ..." : "حفظ الدَّين"}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-100"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
