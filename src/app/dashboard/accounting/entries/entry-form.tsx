"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Account, ENTRY_TEMPLATES, formatPrice } from "@/lib/types";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Line = { account_id: string; debit: string; credit: string };

// نموذج قيد يومية — قوالب جاهزة + محرّر يدوي متوازن (مدين = دائن)
export default function EntryForm({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const supabase = createClient();

  const [entryDate, setEntryDate] = useState(today());
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { account_id: "", debit: "", credit: "" },
    { account_id: "", debit: "", credit: "" },
  ]);
  const [templateKey, setTemplateKey] = useState("");
  const [templateAmount, setTemplateAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // خريطة الكود → معرّف الحساب (لتطبيق القوالب)
  const codeToId = useMemo(() => {
    const m: Record<string, string> = {};
    accounts.forEach((a) => (m[a.code] = a.id));
    return m;
  }, [accounts]);

  // تطبيق قالب جاهز: يولّد سطرين متوازنين
  function applyTemplate() {
    const tpl = ENTRY_TEMPLATES.find((t) => t.key === templateKey);
    if (!tpl || !templateAmount) {
      setError("اختر القالب وأدخل المبلغ أولاً.");
      return;
    }
    setError(null);
    setLines([
      { account_id: codeToId[tpl.debit] ?? "", debit: templateAmount, credit: "" },
      { account_id: codeToId[tpl.credit] ?? "", debit: "", credit: templateAmount },
    ]);
    if (!description) {
      setDescription(tpl.label);
    }
  }

  function updateLine(i: number, field: keyof Line, value: string) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l))
    );
  }

  function addLine() {
    setLines((prev) => [...prev, { account_id: "", debit: "", credit: "" }]);
  }

  function removeLine(i: number) {
    setLines((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!description.trim()) {
      setError("اكتب بيان القيد.");
      return;
    }
    // كل سطر: حساب محدّد + طرف واحد فقط (مدين أو دائن) بقيمة موجبة
    for (const l of lines) {
      const d = Number(l.debit) || 0;
      const c = Number(l.credit) || 0;
      if (!l.account_id && (d > 0 || c > 0)) {
        setError("اختر الحساب لكل سطر فيه مبلغ.");
        return;
      }
      if (d > 0 && c > 0) {
        setError("كل سطر يكون مديناً أو دائناً فقط، وليس الاثنين.");
        return;
      }
    }
    if (!balanced) {
      setError("القيد غير متوازن: مجموع المدين يجب أن يساوي مجموع الدائن.");
      return;
    }

    // نتجاهل السطور الفارغة تماماً
    const validLines = lines.filter(
      (l) => l.account_id && ((Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0)
    );
    if (validLines.length < 2) {
      setError("القيد يحتاج سطرين على الأقل.");
      return;
    }

    setSaving(true);
    // 1) إنشاء رأس القيد
    const { data: entry, error: entryError } = await supabase
      .from("journal_entries")
      .insert({ entry_date: entryDate, description: description.trim() })
      .select("id")
      .single();

    if (entryError || !entry) {
      setSaving(false);
      setError("تعذّر حفظ القيد: " + (entryError?.message ?? ""));
      return;
    }

    // 2) إنشاء السطور
    const payload = validLines.map((l) => ({
      entry_id: entry.id,
      account_id: l.account_id,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
    }));
    const { error: linesError } = await supabase.from("journal_lines").insert(payload);

    if (linesError) {
      // تراجع: نحذف رأس القيد حتى لا يبقى قيد بلا سطور
      await supabase.from("journal_entries").delete().eq("id", entry.id);
      setSaving(false);
      setError("تعذّر حفظ سطور القيد: " + linesError.message);
      return;
    }

    setSaving(false);
    router.push("/dashboard/accounting/entries");
    router.refresh();
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* القالب السريع */}
      <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
        <h3 className="mb-3 text-sm font-semibold text-brand-800">
          ⚡ قالب سريع (يولّد القيد تلقائياً)
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs text-gray-600">نوع العملية</label>
            <select
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
              className={inputClass + " bg-white"}
            >
              <option value="">— اختر عملية —</option>
              {ENTRY_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs text-gray-600">المبلغ</label>
            <input
              type="number"
              min="0"
              step="any"
              dir="ltr"
              value={templateAmount}
              onChange={(e) => setTemplateAmount(e.target.value)}
              className={inputClass + " bg-white text-left"}
              placeholder="0"
            />
          </div>
          <button
            type="button"
            onClick={applyTemplate}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            توليد القيد
          </button>
        </div>
      </div>

      {/* رأس القيد */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              التاريخ <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              dir="ltr"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className={inputClass + " text-left"}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              بيان القيد <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
              placeholder="وصف العملية"
            />
          </div>
        </div>

        {/* سطور القيد */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[560px] text-right text-sm">
            <thead className="text-gray-500">
              <tr>
                <th className="pb-2 font-medium">الحساب</th>
                <th className="w-32 pb-2 font-medium">مدين</th>
                <th className="w-32 pb-2 font-medium">دائن</th>
                <th className="w-10 pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1.5 pl-2">
                    <select
                      value={l.account_id}
                      onChange={(e) => updateLine(i, "account_id", e.target.value)}
                      className={inputClass}
                    >
                      <option value="">— اختر الحساب —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pl-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      dir="ltr"
                      value={l.debit}
                      onChange={(e) => updateLine(i, "debit", e.target.value)}
                      className={inputClass + " text-left"}
                      placeholder="0"
                    />
                  </td>
                  <td className="py-1.5 pl-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      dir="ltr"
                      value={l.credit}
                      onChange={(e) => updateLine(i, "credit", e.target.value)}
                      className={inputClass + " text-left"}
                      placeholder="0"
                    />
                  </td>
                  <td className="py-1.5 text-center">
                    {lines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        className="text-red-500 hover:text-red-700"
                        title="حذف السطر"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="py-2 text-gray-600">الإجمالي</td>
                <td className="py-2 text-left" dir="ltr">{formatPrice(totalDebit)}</td>
                <td className="py-2 text-left" dir="ltr">{formatPrice(totalCredit)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={addLine}
            className="text-sm text-brand-700 hover:underline"
          >
            + إضافة سطر
          </button>
          {/* مؤشر التوازن */}
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              balanced
                ? "bg-green-100 text-green-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {balanced
              ? "✓ القيد متوازن"
              : `غير متوازن — الفرق ${formatPrice(Math.abs(totalDebit - totalCredit))}`}
          </span>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving || !balanced}
          className="rounded-lg bg-brand-600 px-6 py-2.5 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "جاري الحفظ..." : "حفظ القيد"}
        </button>
        <Link
          href="/dashboard/accounting/entries"
          className="rounded-lg border border-gray-300 px-6 py-2.5 font-medium text-gray-700 transition hover:bg-gray-100"
        >
          إلغاء
        </Link>
      </div>
    </form>
  );
}
