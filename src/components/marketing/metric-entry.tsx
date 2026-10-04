"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "./record-form";

// ============================================================
// إدخال مقاييس يومٍ يدوياً لكيانٍ واحد — يمرّ بـ mkt_import_metrics نفسها
// التي يمرّ بها الاستيراد والمزامنة، فلا مسار كتابة ثالث. وإعادة إدخال
// اليوم نفسه تحديثٌ لا تكرار (المفتاح: الكيان × اليوم).
// ============================================================
const SOCIAL = [["impressions", "ظهور"], ["reach", "وصول"], ["engagements", "تفاعل"], ["likes", "إعجاب"], ["comments", "تعليق"],
  ["shares", "مشاركة"], ["saves", "حفظ"], ["video_views", "مشاهدات"], ["watch_seconds", "ثواني المشاهدة"],
  ["followers_gained", "متابعون جدد"], ["link_clicks", "نقر رابط"], ["leads", "ليدات (المنصّة)"]] as const;
const ADS = [["spend", "المصروف (د.ع)"], ["impressions", "ظهور"], ["reach", "وصول"], ["clicks", "نقرات"], ["link_clicks", "نقر رابط"],
  ["leads", "ليدات (المنصّة)"], ["conversions", "تحويلات"], ["video_views", "مشاهدات"]] as const;
const OFFLINE = [["visitors", "زوّار"], ["impressions", "مشاهدات تقديرية"], ["leads", "ليدات (مسجّلة يدوياً)"], ["spend", "المصروف (د.ع)"]] as const;

export default function MetricEntry({ entityType, entityId, social = false, offline = false }: {
  entityType: string; entityId: string; social?: boolean; offline?: boolean;
}) {
  const router = useRouter();
  const fields = offline ? OFFLINE : social ? SOCIAL : ADS;
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr(null);
    const row: Record<string, unknown> = { date, entity_type: entityType, entity_id: entityId };
    for (const [k] of fields) if (vals[k]) row[k] = Number(vals[k]);
    setBusy(true);
    const { data, error } = await createClient().rpc("mkt_import_metrics", { p_rows: [row], p_source: "يدوي" });
    setBusy(false);
    if (error) return setErr(friendlyError(error.message, error.code));
    const r = data as { failed: number; errors: { error: string }[] };
    if (r.failed > 0) return setErr(r.errors[0]?.error ?? "رُفض الصفّ");
    setVals({});
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-xs text-brand-600 hover:underline">+ أدخل أرقام يوم</button>;
  }
  return (
    <div className="rounded border border-gray-200 p-2 text-xs">
      <label className="mb-2 block">اليوم <input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" className="ms-2 rounded border px-1 py-0.5" /></label>
      <div className="grid grid-cols-3 gap-2">
        {fields.map(([k, l]) => (
          <label key={k}>{l}<input type="number" min={0} value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} dir="ltr" className="mt-0.5 w-full rounded border px-1 py-0.5" /></label>
        ))}
      </div>
      {err && <p className="mt-1 text-red-700">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={save} className="rounded bg-brand-600 px-3 py-1 font-semibold text-white">{busy ? "…" : "احفظ"}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded border px-3 py-1">إلغاء</button>
      </div>
    </div>
  );
}
