"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// إضافة هدف — للمدير وحده (سياسة القاعدة sql/078).
// المفتاح المركّب في الجدول يمنع هدفين لنفس (النطاق، المدة، المقياس)،
// فالإدخال المكرّر يُرفض من القاعدة برسالة واضحة لا يُطمَس بصمت.
// ============================================================
export default function TargetForm({
  employees, projects, defaultStart,
}: { employees: { id: string; full_name: string }[]; projects: { id: string; name: string }[]; defaultStart: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ scope: "شركة", scope_id: "", period_type: "شهري", period_start: defaultStart, metric: "صفقات", target_value: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setMsg(null);
    if (!f.target_value || Number(f.target_value) <= 0) return setMsg("أدخل قيمة موجبة.");
    if (f.scope !== "شركة" && !f.scope_id) return setMsg("اختر النطاق.");
    setBusy(true);
    const { error } = await supabase.from("sales_targets").insert({
      scope: f.scope,
      scope_id: f.scope === "شركة" ? null : f.scope_id,
      period_type: f.period_type,
      period_start: f.period_start,
      metric: f.metric,
      target_value: Number(f.target_value),
    });
    setBusy(false);
    if (error) return setMsg(error.message.includes("duplicate") ? "يوجد هدف لهذا النطاق والمدة والمقياس — عدّله بدل إضافته." : error.message);
    setOpen(false);
    setF({ ...f, target_value: "" });
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-600 hover:bg-brand-50">
        + هدف جديد
      </button>
    );
  }

  const inp = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h3 className="font-bold text-gray-800">هدف جديد</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value, scope_id: "" })} className={inp}>
          <option value="شركة">الشركة</option>
          <option value="موظف">موظف</option>
          <option value="مشروع">مشروع</option>
        </select>
        {f.scope === "موظف" && (
          <select value={f.scope_id} onChange={(e) => setF({ ...f, scope_id: e.target.value })} className={inp}>
            <option value="">— الموظف —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        )}
        {f.scope === "مشروع" && (
          <select value={f.scope_id} onChange={(e) => setF({ ...f, scope_id: e.target.value })} className={inp}>
            <option value="">— المشروع —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select value={f.period_type} onChange={(e) => setF({ ...f, period_type: e.target.value })} className={inp}>
          <option value="شهري">شهري</option>
          <option value="ربعي">ربعي</option>
          <option value="سنوي">سنوي</option>
        </select>
        <input type="date" value={f.period_start} onChange={(e) => setF({ ...f, period_start: e.target.value })} className={inp} />
        <select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })} className={inp}>
          <option value="صفقات">صفقات</option>
          <option value="وحدات">وحدات</option>
          <option value="إيراد">إيراد (عمولة تلال)</option>
        </select>
        <input type="number" min={1} placeholder="القيمة المستهدَفة" value={f.target_value} onChange={(e) => setF({ ...f, target_value: e.target.value })} className={inp} />
      </div>
      {msg && <p className="mt-2 text-sm text-red-700">{msg}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">حفظ</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600">إلغاء</button>
      </div>
    </div>
  );
}
