"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { LEAD_FIELDS, mapRows, toImportPayload, type LeadMapping, type LeadSheetRow } from "@/lib/lead-sheet";
import { CHANNEL_OPTIONS } from "@/lib/leads-shared";

type Preview = { fileName: string; fileHash: string; headers: string[]; rows: string[][]; mapping: LeadMapping; truncated: boolean; maxRows: number };
type Totals = { sent: number; created: number; linked: number; rejected: number; errors: number; already: number };
const ZERO: Totals = { sent: 0, created: 0, linked: 0, rejected: 0, errors: 0, already: 0 };

// ٤٠ صفّاً في الطلب: كل صفّ يمرّ بـ intake_lead (توزيع، درجة، محفّزات)،
// ومهلة جملة المستخدم في القاعدة ٨ ثوانٍ
const CHUNK = 40;

export default function LeadImporter({ campaigns, projects }: {
  campaigns: { id: string; name: string; project_id: string | null }[];
  projects: { id: string; name: string }[];
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<LeadMapping>({});
  const [campaign, setCampaign] = useState("");
  const [project, setProject] = useState("");
  const [channel, setChannel] = useState("facebook");
  const [known, setKnown] = useState<{ phones: Set<string>; ids: Set<string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [done, setDone] = useState(0);         // صفوف أُرسلت بنجاح من هذه الدفعة
  const [totals, setTotals] = useState<Totals>(ZERO);
  const [finished, setFinished] = useState(false);

  const rows: LeadSheetRow[] = useMemo(() => (preview ? mapRows(preview.rows, mapping) : []), [preview, mapping]);
  const toSend = rows.filter((r) => r.issue !== "مكرّر داخل الملف");

  const statusOf = (r: LeadSheetRow): { label: string; tone: string } => {
    if (r.issue === "مكرّر داخل الملف") return { label: "مكرّر داخل الملف — لن يُرسل", tone: "text-gray-400" };
    if (r.issue) return { label: `${r.issue} — يُسجَّل في قائمة الأخطاء`, tone: "text-amber-700" };
    if (known && r.metaId && known.ids.has(r.metaId)) return { label: "وصل سابقاً بالويبهوك", tone: "text-gray-500" };
    if (known && r.phoneKey && known.phones.has(r.phoneKey)) return { label: "عميل قائم — يُربط", tone: "text-blue-700" };
    return { label: "جديد", tone: "text-brand-700" };
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) {
      const k = statusOf(r).label.split(" — ")[0];
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
    // statusOf يقرأ known فقط
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, known]);

  const upload = async (file: File) => {
    setBusy(true); setError(null); setPreview(null); setKnown(null); setBatchId(null); setDone(0); setTotals(ZERO); setFinished(false);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/leads/import/preview", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({ error: "استجابة غير مفهومة" }));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "تعذّرت قراءة الملف");
    setPreview(body as Preview);
    setMapping((body as Preview).mapping);
  };

  const check = async () => {
    setBusy(true); setError(null);
    const phones = Array.from(new Set(rows.map((r) => r.phoneKey).filter(Boolean))) as string[];
    const ids = Array.from(new Set(rows.map((r) => r.metaId).filter(Boolean))) as string[];
    const { data, error } = await createClient().rpc("lead_import_precheck", { p_phones: phones, p_meta_ids: ids });
    setBusy(false);
    if (error) return setError(error.message);
    const d = data as { existing_phones: string[]; received_ids: string[] };
    setKnown({ phones: new Set(d.existing_phones), ids: new Set(d.received_ids) });
  };

  // الحفظ: دفعة واحدة في القاعدة، تُرسل قطعاً. الانقطاع ثم «استئناف» يعيد
  // الإرسال من آخر قطعة نجحت؛ ولو أُعيد ما نجح فالمفتاح يمنع تكراره.
  const commit = async () => {
    if (!preview) return;
    setBusy(true); setError(null);
    const supabase = createClient();
    let id = batchId;
    if (!id) {
      const { data, error } = await supabase.rpc("lead_import_begin", {
        p_file_name: preview.fileName, p_file_hash: preview.fileHash,
        p_campaign_id: campaign || null,
        p_project_id: project || campaigns.find((c) => c.id === campaign)?.project_id || null,
        p_channel: channel || null, p_mapping: mapping,
      });
      if (error) { setBusy(false); return setError(error.message); }
      id = data as string;
      setBatchId(id);
    }
    let sent = done;
    let acc = totals;
    while (sent < toSend.length) {
      const chunk = toSend.slice(sent, sent + CHUNK).map(toImportPayload);
      const { data, error } = await supabase.rpc("lead_import_rows", { p_batch: id, p_rows: chunk });
      if (error) {
        setBusy(false);
        return setError(`توقّف بعد ${sent} صفّ: ${error.message} — اضغط «استئناف»؛ ما حُفظ لن يتكرّر.`);
      }
      const r = data as Totals;
      acc = { sent: acc.sent + r.sent, created: acc.created + r.created, linked: acc.linked + r.linked,
              rejected: acc.rejected + r.rejected, errors: acc.errors + r.errors, already: acc.already + r.already };
      sent += chunk.length;
      setDone(sent);
      setTotals(acc);
    }
    setBusy(false);
    setFinished(true);
  };

  const downloadIssues = () => {
    const bad = rows.filter((r) => r.issue);
    const csv = ["الصف,الاسم,الهاتف,المشكلة", ...bad.map((r) => [r.rowNumber, r.name, r.phone, r.issue].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `مشكلات-${preview?.fileName ?? "ملف"}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-white p-4">
        <input type="file" accept=".xlsx,.csv,.tsv,.txt" disabled={busy}
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        {preview && (
          <p className="mt-2 text-sm text-gray-600">
            {preview.fileName}: {preview.rows.length} صفّ{preview.truncated && ` (أول ${preview.maxRows} فقط — قسّم الملف)`}
          </p>
        )}
      </section>

      {error && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {preview && !finished && (
        <>
          <section className="space-y-3 rounded-lg border bg-white p-4">
            <h2 className="font-bold text-gray-800">١) مطابقة الأعمدة</h2>
            <div className="grid gap-2 md:grid-cols-3">
              {LEAD_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <span className="w-36 text-gray-600">{f.label}{"required" in f && f.required ? " *" : ""}</span>
                  <select value={mapping[f.key] ?? ""} disabled={!!batchId}
                    onChange={(e) => { setKnown(null); setMapping({ ...mapping, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) }); }}
                    className="flex-1 rounded border px-2 py-1">
                    <option value="">—</option>
                    {preview.headers.map((h, i) => <option key={i} value={i}>{h || `عمود ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="grid gap-2 border-t pt-3 md:grid-cols-3">
              <label className="text-sm">
                <span className="text-gray-600">حملة الملف (تغلب على عمود الحملة)</span>
                <select value={campaign} disabled={!!batchId} onChange={(e) => setCampaign(e.target.value)} className="mt-1 w-full rounded border px-2 py-1">
                  <option value="">— من عمود الحملة —</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-gray-600">المشروع</span>
                <select value={project} disabled={!!batchId} onChange={(e) => setProject(e.target.value)} className="mt-1 w-full rounded border px-2 py-1">
                  <option value="">— من الحملة —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-gray-600">القناة (حين لا عمود منصّة)</span>
                <select value={channel} disabled={!!batchId} onChange={(e) => setChannel(e.target.value)} className="mt-1 w-full rounded border px-2 py-1">
                  {CHANNEL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
            </div>
            {mapping.phone === undefined && <p className="text-sm text-amber-700">اختر عمود الهاتف — بدونه يصير كل صفّ «بلا رقم».</p>}
          </section>

          <section className="space-y-3 rounded-lg border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold text-gray-800">٢) المعاينة</h2>
              <div className="flex flex-wrap gap-2 text-sm">
                <button onClick={check} disabled={busy || rows.length === 0} className="rounded border px-3 py-1 hover:bg-gray-50">افحص مقابل النظام</button>
                {rows.some((r) => r.issue) && <button onClick={downloadIssues} className="rounded border px-3 py-1 hover:bg-gray-50">نزّل المشكلات CSV</button>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(counts).map(([k, n]) => <span key={k} className="rounded-full bg-gray-100 px-2 py-0.5">{k}: {n}</span>)}
              {!known && <span className="text-gray-500">«افحص مقابل النظام» يميّز الجديد من العميل القائم وما وصل سابقاً.</span>}
            </div>
            <div className="max-h-96 overflow-auto rounded border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-500">
                  <tr><th className="p-1.5">الصف</th><th className="p-1.5 text-right">الاسم</th><th className="p-1.5">الهاتف</th><th className="p-1.5 text-right">الحملة</th><th className="p-1.5">المنصّة</th><th className="p-1.5 text-right">الحالة</th></tr>
                </thead>
                <tbody>
                  {rows.slice(0, 500).map((r) => {
                    const st = statusOf(r);
                    return (
                      <tr key={r.rowNumber} className="border-t">
                        <td className="p-1.5 text-center text-gray-400">{r.rowNumber}</td>
                        <td className="p-1.5">{r.name || "—"}</td>
                        <td className="p-1.5 font-mono" dir="ltr">{r.phone || "—"}</td>
                        <td className="p-1.5">{r.campaign || r.campaign_code || "—"}</td>
                        <td className="p-1.5 text-center">{r.platform || "—"}</td>
                        <td className={`p-1.5 ${st.tone}`}>{st.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 500 && <p className="p-2 text-center text-xs text-gray-400">تُعرض أول ٥٠٠ صفّ؛ الحفظ يشمل الكل.</p>}
            </div>
          </section>

          <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-4">
            <button onClick={commit} disabled={busy || toSend.length === 0 || mapping.phone === undefined}
              className="rounded-lg bg-brand-600 px-5 py-2 font-semibold text-white disabled:opacity-50">
              {busy ? `يُحفظ… ${done}/${toSend.length}` : batchId && done < toSend.length ? "استئناف" : `احفظ ${toSend.length} صفّ`}
            </button>
            <span className="text-xs text-gray-500">الحفظ آمن عند الإعادة: ما سُجّل قبلاً يُعدّ «سبق تسجيله» ولا يتكرّر.</span>
          </section>
        </>
      )}

      {finished && (
        <section className="space-y-2 rounded-lg border border-brand-200 bg-brand-50 p-5">
          <p className="font-semibold text-gray-800">اكتمل الاستيراد.</p>
          <ul className="grid grid-cols-2 gap-1 text-sm md:grid-cols-3">
            <li>عميل جديد: <b>{totals.created}</b></li>
            <li>رُبط بعميل قائم: <b>{totals.linked}</b></li>
            <li>سبق تسجيله: <b>{totals.already}</b></li>
            <li className="text-amber-800">مرفوض (في قائمة الأخطاء): <b>{totals.rejected}</b></li>
            <li className="text-red-700">خطأ (يُعاد تلقائياً): <b>{totals.errors}</b></li>
            <li className="text-gray-500">مكرّر داخل الملف (لم يُرسل): <b>{rows.length - toSend.length}</b></li>
          </ul>
          <div className="flex gap-2 pt-2 text-sm">
            <Link href="/dashboard/crm/leads?tab=errors" className="rounded border bg-white px-3 py-1.5">قائمة الأخطاء</Link>
            <Link href="/dashboard/crm/leads?tab=batches" className="rounded border bg-white px-3 py-1.5">الدفعات</Link>
          </div>
        </section>
      )}
    </div>
  );
}
