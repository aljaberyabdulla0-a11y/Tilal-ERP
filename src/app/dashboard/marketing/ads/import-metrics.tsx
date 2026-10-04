"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { csvToMetricRows } from "@/lib/metrics-csv";

// استيراد CSV من مدير الإعلانات — يُقرأ في المتصفّح ويُرسل صفوفاً إلى
// mkt_import_metrics، فتعود أخطاء كل صفّ برقمه.
export default function ImportMetrics() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [rate, setRate] = useState("1310");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: number; failed: number; errors: { row: number; error: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);

  async function run() {
    setErr(null); setOut(null);
    if (!file) return setErr("اختر ملفّاً.");
    const parsed = csvToMetricRows(await file.text(), { usdRate: Number(rate) || 1 });
    setUnknown(parsed.unknownHeaders);
    if (parsed.error) return setErr(parsed.error);
    setBusy(true);
    const { data, error } = await createClient().rpc("mkt_import_metrics", { p_rows: parsed.rows, p_source: "استيراد" });
    setBusy(false);
    if (error) return setErr(error.message);
    setOut(data as { ok: number; failed: number; errors: { row: number; error: string }[] });
    router.refresh();
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <input type="file" accept=".csv,.tsv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <label className="text-xs text-gray-500">سعر الدولار بالدينار (لعمود Amount spent (USD))
          <input value={rate} onChange={(e) => setRate(e.target.value)} dir="ltr" className="mt-1 block w-28 rounded border px-2 py-1" /></label>
        <button type="button" disabled={busy} onClick={run} className="rounded-lg bg-brand-600 px-4 py-1.5 font-semibold text-white disabled:opacity-50">{busy ? "يستورد…" : "استورد"}</button>
      </div>
      <p className="text-xs text-gray-500">
        الأعمدة: <span dir="ltr">date, ad_external_id | campaign_code | content_code | activity_code, spend, impressions, reach, clicks, link_clicks, leads…</span>
        — أو تصدير ميتا كما هو (<span dir="ltr">Day, Ad ID, Amount spent (USD), Impressions, Reach, Link clicks, Results</span>). إعادة الاستيراد تُحدّث اليوم ولا تكرّره.
      </p>
      {unknown.length > 0 && <p className="text-xs text-gray-400">أعمدة تُجوهلت: {unknown.join("، ")}</p>}
      {err && <p className="text-xs text-red-700">{err}</p>}
      {out && (
        <div className="rounded bg-gray-50 p-2 text-xs">
          <p><b className="text-brand-700">{out.ok}</b> صفّاً دخل · <b className={out.failed ? "text-red-700" : ""}>{out.failed}</b> رُفض</p>
          {out.errors.slice(0, 20).map((e) => <p key={e.row} className="text-red-700">الصفّ {e.row + 1}: {e.error}</p>)}
        </div>
      )}
    </div>
  );
}
