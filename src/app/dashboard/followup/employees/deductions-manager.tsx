"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  DEDUCTION_REASONS,
  Deduction,
  TeamMember,
  formatPrice,
} from "@/lib/types";

// ============================================================
// الاستقطاعات — يسجّلها مدير المتابعة على الموظفين (sql/041).
//
// الفكرة التي يجب أن تصل للمستخدم من الشاشة نفسها:
//   الخصم **لا يُنفَّذ الآن** — يُحتسب في كشف الراتب القادم. فما دام
//   الكشف لم يُولَّد بعد يبقى قابلاً للتصحيح والحذف، وبعده يُقفل.
// لذلك عمود «الحالة» موجود، وزر الحذف يختفي وحده عند القفل تماماً
// كما تقفله سياسة القاعدة — فلا زرّ يعد بما لا يقدر عليه.
// ============================================================
export default function DeductionsManager({
  employees,
  deductions,
  myEmployeeId,
  myUserId,
  isAdmin,
  monthLabel,
}: {
  employees: TeamMember[];
  deductions: Deduction[];
  myEmployeeId: string | null;
  myUserId: string;
  isAdmin: boolean;
  monthLabel: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Baghdad",
  });

  const [form, setForm] = useState({
    employee_id: "",
    amount: "",
    ded_date: today,
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // لا أحد يخصم على نفسه — والقاعدة ترفضه أصلاً، فنُخرجه من القائمة
  // بدل أن يختاره ثم يصطدم برفض.
  const targets = employees.filter(
    (e) => e.status === "active" && e.id !== myEmployeeId
  );

  const nameOf = (id: string) =>
    employees.find((e) => e.id === id)?.full_name ?? "—";

  const total = deductions.reduce((s, d) => s + Number(d.amount), 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);

    const amount = Number(form.amount);
    if (!form.employee_id) {
      setError("اختر الموظف.");
      return;
    }
    if (!amount || amount <= 0) {
      setError("اكتب مبلغاً أكبر من صفر.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("deductions").insert({
      employee_id: form.employee_id,
      amount,
      ded_date: form.ded_date,
      reason: form.reason.trim() || null,
    });
    setSaving(false);

    if (error) {
      setError("تعذّر التسجيل: " + error.message);
      return;
    }

    setDone(
      `سُجّل خصم ${formatPrice(amount)} على ${nameOf(form.employee_id)} — يُحتسب في كشف راتبه القادم.`
    );
    setForm({ employee_id: "", amount: "", ded_date: today, reason: "" });
    router.refresh();
  }

  async function remove(d: Deduction) {
    if (
      !confirm(
        `حذف خصم ${formatPrice(Number(d.amount))} عن ${nameOf(d.employee_id)}؟`
      )
    )
      return;

    setError(null);
    const { error, count } = await supabase
      .from("deductions")
      .delete({ count: "exact" })
      .eq("id", d.id);

    if (error) {
      setError("تعذّر الحذف: " + error.message);
      return;
    }
    if (!count) {
      setError("لا تملك صلاحية حذف خصم سجّله غيرك.");
      return;
    }
    router.refresh();
  }

  const inputCls =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
  const labelCls = "mb-1 block text-xs font-medium text-gray-600";

  return (
    <div className="glass-card p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-gray-800">
          الاستقطاعات — {monthLabel}
        </h2>
        <span className="rounded-full bg-red-50 px-3 py-1 text-sm font-bold text-red-700" dir="ltr">
          {formatPrice(total)}
        </span>
      </div>
      <p className="mb-4 text-sm text-gray-500">
        الخصم يُحتسب تلقائياً في <b>كشف الراتب القادم</b> للموظف. ما دام الكشف
        لم يُولَّد يمكنك تصحيحه أو حذفه، وبعد توليده يُقفل ويصبح تعديله للمدير.
      </p>

      {/* تسجيل خصم */}
      <form
        onSubmit={add}
        className="mb-5 grid grid-cols-1 gap-3 rounded-xl border border-dashed border-gray-300 p-4 sm:grid-cols-5"
      >
        <div className="sm:col-span-2">
          <label className={labelCls}>الموظف</label>
          <select
            required
            value={form.employee_id}
            onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
            className={inputCls + " w-full"}
          >
            <option value="">— اختر الموظف —</option>
            {targets.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>المبلغ</label>
          <input
            required
            type="number"
            min="1"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className={inputCls + " w-full"}
            dir="ltr"
          />
        </div>

        <div>
          <label className={labelCls}>التاريخ</label>
          <input
            required
            type="date"
            value={form.ded_date}
            onChange={(e) => setForm({ ...form, ded_date: e.target.value })}
            className={inputCls + " w-full"}
            dir="ltr"
          />
        </div>

        <div>
          <label className={labelCls}>السبب</label>
          <input
            list="deduction-reasons"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            placeholder="تأخير، غياب…"
            className={inputCls + " w-full"}
          />
          <datalist id="deduction-reasons">
            {DEDUCTION_REASONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>

        <div className="sm:col-span-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "جارٍ التسجيل..." : "+ تسجيل خصم"}
          </button>
          {error && <span className="text-sm text-red-700">{error}</span>}
          {done && !error && (
            <span className="text-sm text-emerald-700">{done}</span>
          )}
        </div>
      </form>

      {/* السجلّ */}
      {deductions.length === 0 ? (
        <p className="rounded-xl bg-gray-50 p-6 text-center text-sm text-gray-500">
          لا استقطاعات مسجّلة في هذا الشهر.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[750px] text-start text-sm">
            <thead className="border-b text-gray-600">
              <tr>
                <th className="px-4 py-2 text-start font-medium">الموظف</th>
                <th className="px-4 py-2 text-start font-medium">المبلغ</th>
                <th className="px-4 py-2 text-start font-medium">التاريخ</th>
                <th className="px-4 py-2 text-start font-medium">السبب</th>
                <th className="px-4 py-2 text-start font-medium">سجّله</th>
                <th className="px-4 py-2 text-start font-medium">الحالة</th>
                <th className="px-4 py-2 text-start font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {deductions.map((d) => {
                const locked = Boolean(d.payroll_id);
                const mine = d.created_by === myUserId;
                return (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2 font-semibold text-gray-800">
                      {nameOf(d.employee_id)}
                    </td>
                    <td className="px-4 py-2 font-bold text-red-700" dir="ltr">
                      {formatPrice(Number(d.amount))}
                    </td>
                    <td className="px-4 py-2 text-gray-600" dir="ltr">
                      {d.ded_date}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{d.reason ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-500">
                      {d.created_by_name ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          locked
                            ? "rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600"
                            : "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700"
                        }
                      >
                        {locked ? "ضُمّ لكشف راتب" : "في انتظار الكشف"}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {!locked && (mine || isAdmin) && (
                        <button
                          onClick={() => remove(d)}
                          className="text-xs font-medium text-red-600 transition hover:underline"
                        >
                          حذف
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
