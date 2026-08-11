"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@/lib/types";

// نموذج إضافة حساب جديد إلى شجرة الحسابات
export default function AccountForm() {
  const router = useRouter();
  const supabase = createClient();

  const [form, setForm] = useState({ code: "", name: "", type: "expense" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const { error } = await supabase.from("accounts").insert({
      code: form.code.trim(),
      name: form.name.trim(),
      type: form.type,
    });
    setSaving(false);

    if (error) {
      setError(
        error.message.includes("duplicate")
          ? "رقم الحساب مستخدم بالفعل، اختر رقماً آخر."
          : "تعذّر الحفظ: " + error.message
      );
      return;
    }

    router.push("/dashboard/accounting/accounts");
    router.refresh();
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const labelClass = "mb-1 block text-sm font-medium text-gray-700";

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-lg space-y-5 rounded-2xl bg-white p-8 shadow-sm"
    >
      <div>
        <label className={labelClass}>رقم الحساب (الكود)</label>
        <input
          type="text"
          required
          dir="ltr"
          value={form.code}
          onChange={(e) => update("code", e.target.value)}
          className={inputClass + " text-start"}
          placeholder="مثال: 5900"
        />
        <p className="mt-1 text-xs text-gray-400">
          1xxx أصول • 2xxx التزامات • 3xxx حقوق ملكية • 4xxx إيرادات • 5xxx مصروفات
        </p>
      </div>

      <div>
        <label className={labelClass}>اسم الحساب</label>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          className={inputClass}
          placeholder="مثال: مصاريف نقل"
        />
      </div>

      <div>
        <label className={labelClass}>نوع الحساب</label>
        <select
          required
          value={form.type}
          onChange={(e) => update("type", e.target.value)}
          className={inputClass}
        >
          {ACCOUNT_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
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
          {saving ? "جاري الحفظ..." : "حفظ الحساب"}
        </button>
        <Link
          href="/dashboard/accounting/accounts"
          className="rounded-lg border border-gray-300 px-6 py-2.5 font-medium text-gray-700 transition hover:bg-gray-100"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
