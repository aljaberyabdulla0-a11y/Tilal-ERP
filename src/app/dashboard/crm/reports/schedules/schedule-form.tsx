"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// إنشاء تقرير مجدول وتعديله (§41).
//
// التسليم إشعارٌ داخلي برابطٍ إلى تشغيلٍ محفوظ (099): المدى يُحسم يوم
// الإرسال، والأرقام تُحسب عند الفتح بصلاحية المستلم — فمشرفٌ في قائمة
// المستلمين يرى فريقه لا الشركة، ولو جدولها المدير.
// ============================================================

export type ScheduleDraft = {
  id?: string;
  template_id: string;
  name: string;
  frequency: "daily" | "weekly" | "monthly";
  run_time: string;
  weekday: number | null;
  month_day: number | null;
  range_preset: string;
  compare: string;
  recipients: string[];
  format: string;
  is_active: boolean;
  filters: Record<string, unknown>;
};

const PRESETS: [string, string][] = [
  ["yesterday", "أمس"], ["today", "اليوم"], ["last_7", "آخر ٧ أيام"], ["last_14", "آخر ١٤ يوماً"],
  ["last_30", "آخر ٣٠ يوماً"], ["this_week", "هذا الأسبوع"], ["last_week", "الأسبوع الماضي"],
  ["this_month", "هذا الشهر"], ["last_month", "الشهر الماضي"], ["this_quarter", "هذا الربع"], ["last_quarter", "الربع الماضي"],
];
const INPUT = "mt-1 block w-full rounded border border-gray-300 px-2 py-1.5";
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export default function ScheduleForm({
  templates, people, initial, onDone,
}: {
  templates: { id: string; name: string }[];
  people: { id: string; label: string }[];
  initial: ScheduleDraft;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [d, setD] = useState<ScheduleDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof ScheduleDraft>(k: K, v: ScheduleDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save() {
    if (!d.name.trim()) return setErr("اسمٌ للتقرير المجدول.");
    if (d.recipients.length === 0) return setErr("مستلمٌ واحد على الأقل.");
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    const row = {
      template_id: d.template_id, name: d.name.trim(), frequency: d.frequency, run_time: d.run_time,
      weekday: d.frequency === "weekly" ? d.weekday ?? 0 : null,
      month_day: d.frequency === "monthly" ? d.month_day ?? 1 : null,
      range_preset: d.range_preset, compare: d.compare, recipients: d.recipients, format: d.format,
      is_active: d.is_active, filters: d.filters, timezone: "Asia/Baghdad",
    };
    const { error } = d.id
      ? await supabase.from("crm_report_schedules").update(row).eq("id", d.id)
      : await supabase.from("crm_report_schedules").insert(row);
    setBusy(false);
    if (error) return setErr(error.message);
    onDone?.();
    router.push("/dashboard/crm/reports/schedules");
    router.refresh();
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="التقرير">
          <select value={d.template_id} onChange={(e) => set("template_id", e.target.value)} className={INPUT}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="الاسم (يظهر في الإشعار)">
          <input value={d.name} onChange={(e) => set("name", e.target.value)} className={INPUT} placeholder="تقرير الإدارة اليومي" />
        </Field>
        <Field label="التكرار">
          <select value={d.frequency} onChange={(e) => set("frequency", e.target.value as ScheduleDraft["frequency"])} className={INPUT}>
            <option value="daily">يومياً</option><option value="weekly">أسبوعياً</option><option value="monthly">شهرياً</option>
          </select>
        </Field>
        <Field label="الوقت (بتوقيت بغداد)">
          <input type="time" value={d.run_time.slice(0, 5)} onChange={(e) => set("run_time", e.target.value)} className={INPUT} dir="ltr" />
        </Field>
        {d.frequency === "weekly" && (
          <Field label="اليوم">
            <select value={d.weekday ?? 0} onChange={(e) => set("weekday", Number(e.target.value))} className={INPUT}>
              {DAYS.map((n, i) => <option key={i} value={i}>{n}</option>)}
            </select>
          </Field>
        )}
        {d.frequency === "monthly" && (
          <Field label="يوم الشهر (١–٢٨)">
            <input type="number" min={1} max={28} value={d.month_day ?? 1} onChange={(e) => set("month_day", Number(e.target.value))} className={INPUT} dir="ltr" />
          </Field>
        )}
        <Field label="المدى في كل إرسال">
          <select value={d.range_preset} onChange={(e) => set("range_preset", e.target.value)} className={INPUT}>
            {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="المقارنة">
          <select value={d.compare} onChange={(e) => set("compare", e.target.value)} className={INPUT}>
            <option value="previous_period">بالفترة السابقة</option><option value="previous_year">بالسنة السابقة</option><option value="none">بلا</option>
          </select>
        </Field>
        <Field label="الصيغة المقترحة في الرابط">
          <select value={d.format} onChange={(e) => set("format", e.target.value)} className={INPUT}>
            <option value="view">عرض</option><option value="xlsx">Excel</option><option value="pdf">PDF</option>
          </select>
        </Field>
      </div>

      <Field label={`المستلمون (${d.recipients.length})`}>
        <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded border border-gray-200 p-2 sm:grid-cols-3">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={d.recipients.includes(p.id)}
                     onChange={(e) => set("recipients", e.target.checked ? [...d.recipients, p.id] : d.recipients.filter((x) => x !== p.id))} />
              <span className="truncate">{p.label}</span>
            </label>
          ))}
        </div>
      </Field>

      {Object.keys(d.filters).length > 0 && (
        <p className="text-xs text-gray-500">مُرشِّحات محفوظة مع الجدولة: {Object.keys(d.filters).join("، ")}</p>
      )}

      <label className="flex items-center gap-2 text-xs text-gray-700">
        <input type="checkbox" checked={d.is_active} onChange={(e) => set("is_active", e.target.checked)} /> مفعّل
      </label>

      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-1.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "يحفظ…" : d.id ? "حفظ التعديل" : "أنشئ الجدولة"}
        </button>
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs text-gray-500">{label}</span>{children}</label>;
}

export function ScheduleRowActions({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) alert(error.message);
    router.refresh();
  };
  const supabase = createClient();
  return (
    <span className="inline-flex gap-3 text-xs">
      <button disabled={busy} className="text-brand-700 hover:underline"
              title="يُرسَل خلال ربع ساعة (نبض المهمة المجدولة)"
              onClick={() => act(() => supabase.from("crm_report_schedules").update({ next_run_at: new Date().toISOString() }).eq("id", id))}>
        أرسل الآن
      </button>
      <button disabled={busy} className="text-gray-600 hover:underline"
              onClick={() => act(() => supabase.from("crm_report_schedules").update({ is_active: !active }).eq("id", id))}>
        {active ? "أوقف" : "فعّل"}
      </button>
      <button disabled={busy} className="text-red-700 hover:underline"
              onClick={() => confirm("حذف الجدولة؟ التشغيلات السابقة تبقى في السجلّ.") && act(() => supabase.from("crm_report_schedules").delete().eq("id", id))}>
        حذف
      </button>
    </span>
  );
}
