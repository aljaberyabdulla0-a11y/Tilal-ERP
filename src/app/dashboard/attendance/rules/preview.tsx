"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  AttendanceDeduction,
  AttendanceRules,
  PAYROLL_LINE_ICONS,
  TeamMember,
  formatPrice,
} from "@/lib/types";

// ============================================================
// معاينة خصم الدوام — «ماذا كان سيُخصم لو شغّلتُ القواعد؟»
//
// ⚠️ **لا تكتب شيئاً.** تنادي attendance_deductions() وهي دالّة
// حاسبة لا كاتبة، ولا تمسّ payroll_lines ولا الدفاتر. وهي نفسها
// التي يناديها build_payroll — فما يُعرض هنا هو بعينه ما سيُكتب،
// لا حسابان قد يفترقان.
//
// وهذا شرط المالك قبل التفعيل: يراجع شهراً كاملاً بعينه، فإن
// اطمأنّ شغّل القواعد بنفسه.
// ============================================================
export default function AttendanceRulesPreview({
  employees,
  rules,
}: {
  employees: TeamMember[];
  rules: AttendanceRules;
}) {
  const router = useRouter();
  const supabase = createClient();

  const thisMonth = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" })
    .slice(0, 7);

  const [period, setPeriod] = useState(thisMonth);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<
    { employee: string; items: AttendanceDeduction[] }[] | null
  >(null);

  const [form, setForm] = useState<AttendanceRules>(rules);
  const [savingRules, setSavingRules] = useState(false);

  async function runPreview() {
    setBusy(true);
    setErr(null);
    setRows(null);

    const out: { employee: string; items: AttendanceDeduction[] }[] = [];
    for (const e of employees) {
      const { data, error } = await supabase.rpc("attendance_deductions", {
        p_employee: e.id,
        p_period: period,
      });
      if (error) {
        setBusy(false);
        setErr(error.message);
        return;
      }
      const items = (data ?? []) as AttendanceDeduction[];
      if (items.length > 0) out.push({ employee: e.full_name, items });
    }

    setRows(out);
    setBusy(false);
  }

  async function saveRules() {
    setSavingRules(true);
    setErr(null);
    const { error } = await supabase
      .from("company_settings")
      .update({
        attendance_rules_enabled: form.attendance_rules_enabled,
        attendance_effective_date: form.attendance_effective_date || null,
        late_grace_minutes: Number(form.late_grace_minutes),
        late_hour_factor: Number(form.late_hour_factor),
        late_absent_threshold_minutes: Number(form.late_absent_threshold_minutes),
        absence_deduction_days: Number(form.absence_deduction_days),
        late_daily_cap_days: Number(form.late_daily_cap_days),
        early_leave_as_late: form.early_leave_as_late,
      })
      .eq("id", 1);
    setSavingRules(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  const total = (rows ?? []).reduce(
    (s, r) => s + r.items.reduce((x, i) => x + Number(i.amount), 0),
    0
  );

  function Field({
    label,
    hint,
    children,
  }: {
    label: string;
    hint: string;
    children: React.ReactNode;
  }) {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
        {children}
        <p className="mt-1 text-[11px] text-gray-400">{hint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ===== حالة المحرّك ===== */}
      <div
        className={`rounded-2xl border p-4 text-sm ${
          form.attendance_rules_enabled
            ? "border-green-300 bg-green-50 text-green-900"
            : "border-amber-300 bg-amber-50 text-amber-900"
        }`}
      >
        {form.attendance_rules_enabled ? (
          <>
            <b>القواعد مُشغَّلة.</b> كل كشف يُبنى من الآن يحمل بنود غياب وتأخير
            محسوبة من البصمة. راجع المعاينة أدناه قبل اعتماد أي كشف.
          </>
        ) : (
          <>
            <b>القواعد مطفأة.</b> لا يُنتج المحرّك بنداً واحداً، ولا يمسّ كشفاً.
            استعمل المعاينة لترى ما <b>كان</b> سيُخصم — ثم شغّلها متى اطمأننت.
          </>
        )}
      </div>

      {/* ===== المعاملات ===== */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h3 className="mb-4 font-semibold text-gray-800">معاملات الخصم</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="تاريخ بدء العمل بالقواعد" hint="لا يُخصم عن أي يوم قبله. بيانات البصمة تبدأ 2026-07-04.">
            <input
              type="date"
              dir="ltr"
              value={form.attendance_effective_date ?? ""}
              onChange={(e) =>
                setForm({ ...form, attendance_effective_date: e.target.value })
              }
              className={input + " text-start"}
            />
          </Field>

          <Field label="مدّة السماح (دقيقة)" hint="عتبة لا خصم: من تجاوزها يُحتسب تأخيره من الدقيقة الأولى.">
            <input
              type="number" min={0} dir="ltr"
              value={form.late_grace_minutes}
              onChange={(e) => setForm({ ...form, late_grace_minutes: Number(e.target.value) })}
              className={input + " text-start"}
            />
          </Field>

          <Field label="مُعامِل شدّة التأخير" hint="1 = قيمة الساعة من الراتب · 0.5 تخفيف · 2 تشديد.">
            <input
              type="number" min={0} step="0.1" dir="ltr"
              value={form.late_hour_factor}
              onChange={(e) => setForm({ ...form, late_hour_factor: Number(e.target.value) })}
              className={input + " text-start"}
            />
          </Field>

          <Field label="عتبة الغياب (دقيقة)" hint="تأخير بلغها يُحتسب غياباً كاملاً — بندٌ واحد لا بندان.">
            <input
              type="number" min={1} dir="ltr"
              value={form.late_absent_threshold_minutes}
              onChange={(e) =>
                setForm({ ...form, late_absent_threshold_minutes: Number(e.target.value) })
              }
              className={input + " text-start"}
            />
          </Field>

          <Field label="أيام تُخصم عن يوم الغياب" hint="1 = يوم بيوم. الرفع عقوبةٌ مضاعفة.">
            <input
              type="number" min={0} step="0.5" dir="ltr"
              value={form.absence_deduction_days}
              onChange={(e) =>
                setForm({ ...form, absence_deduction_days: Number(e.target.value) })
              }
              className={input + " text-start"}
            />
          </Field>

          <Field label="سقف خصم اليوم الواحد" hint="مضاعف قيمة اليوم. 1 = لا يتجاوز خصم اليوم قيمته مهما بلغ التأخير.">
            <input
              type="number" min={0} step="0.5" dir="ltr"
              value={form.late_daily_cap_days}
              onChange={(e) =>
                setForm({ ...form, late_daily_cap_days: Number(e.target.value) })
              }
              className={input + " text-start"}
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-5 border-t border-gray-100 pt-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.early_leave_as_late}
              onChange={(e) => setForm({ ...form, early_leave_as_late: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            خصم الانصراف المبكر بنفس معادلة التأخير
          </label>

          <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <input
              type="checkbox"
              checked={form.attendance_rules_enabled}
              onChange={(e) =>
                setForm({ ...form, attendance_rules_enabled: e.target.checked })
              }
              className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            تشغيل القواعد
          </label>

          <button
            onClick={saveRules}
            disabled={savingRules}
            className="ms-auto rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {savingRules ? "جارٍ الحفظ…" : "حفظ المعاملات"}
          </button>
        </div>

        <p className="mt-3 text-[11px] text-gray-400">
          كل تغيير هنا يُسجَّل في سجلّ التدقيق بقيمته قبل وبعد ومن غيّرها ومتى.
        </p>
      </div>

      {/* ===== المعاينة ===== */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              الشهر
            </label>
            <input
              type="month"
              dir="ltr"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className={input + " text-start"}
            />
          </div>
          <button
            onClick={runPreview}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">visibility</span>
            {busy ? "جارٍ الحساب…" : "معاينة الخصم"}
          </button>

          {rows !== null && (
            <span className="ms-auto text-sm text-gray-600">
              الإجمالي:{" "}
              <b className="text-red-700" dir="ltr">
                {formatPrice(total)}
              </b>{" "}
              على {rows.length} موظفاً
            </span>
          )}
        </div>

        {!form.attendance_rules_enabled && rows === null && (
          <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
            المعاينة تعمل والقواعد مطفأة أيضاً — لكنها ستُرجع صفراً، لأن المحرّك
            لا يحسب وهو مطفأ. شغّل القواعد واحفظ، ثم عايِن قبل بناء أي كشف.
          </p>
        )}

        {err && (
          <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</p>
        )}

        {rows !== null && rows.length === 0 && !err && (
          <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
            لا خصم على أحد في هذا الشهر.
          </p>
        )}

        {rows !== null &&
          rows.map((r) => {
            const sum = r.items.reduce((s, i) => s + Number(i.amount), 0);
            return (
              <div key={r.employee} className="mb-4 rounded-xl border border-gray-200">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/60 px-4 py-2">
                  <b className="text-sm text-gray-800">{r.employee}</b>
                  <span className="text-sm font-bold text-red-700" dir="ltr">
                    − {formatPrice(sum)}
                  </span>
                </div>
                <div className="divide-y divide-gray-100">
                  {r.items.map((i) => (
                    <div key={i.source_id} className="flex items-center gap-3 px-4 py-2">
                      <span className="material-symbols-outlined text-[18px] text-red-400">
                        {PAYROLL_LINE_ICONS[i.category] ?? "remove_circle"}
                      </span>
                      <span className="w-24 shrink-0 text-xs text-gray-500" dir="ltr">
                        {i.work_date}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                        {i.description}
                      </span>
                      <span className="shrink-0 text-sm font-medium text-red-700" dir="ltr">
                        {formatPrice(i.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
      </div>

      <p className="text-xs text-gray-400">
        الاستثناءات اليومية (زيارة موقع، مهمة، إذن) تُدار من{" "}
        <Link href="/dashboard/attendance" className="text-brand-600 hover:underline">
          سجلّ الدوام
        </Link>{" "}
        — واليوم المستثنى لا خصم عليه.
      </p>
    </div>
  );
}
