"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { EmployeeDocument, EmployeeDocumentType } from "@/lib/types";

// ============================================================
// مستندات الموظف (sql/148) — على نمط مستندات العميل (087):
// دلو خاصّ، رابط موقَّع لدقيقة، حذف ناعم. يرفعها HR، ويقرأ الموظف
// ما يُعرض له منها (RLS لا الواجهة).
// ============================================================
const MAX_MB = 20;

function expiryState(d: EmployeeDocument, today: string) {
  if (!d.expiry_date) return null;
  if (d.expiry_date < today) return { label: "منتهٍ", cls: "bg-red-100 text-red-700" };
  const days = Math.round((new Date(d.expiry_date).getTime() - new Date(today).getTime()) / 86400000);
  if (days <= 30) return { label: `ينتهي خلال ${days} يوماً`, cls: "bg-amber-100 text-amber-700" };
  return { label: `ساري حتى ${d.expiry_date}`, cls: "bg-gray-100 text-gray-500" };
}

export default function EmployeeDocumentsPanel({
  employeeId,
  documents,
  types,
  canWrite,
  today,
}: {
  employeeId: string;
  documents: EmployeeDocument[];
  types: EmployeeDocumentType[];
  canWrite: boolean;
  today: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const active = types.filter((t) => t.active);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [typeCode, setTypeCode] = useState(active[0]?.code ?? "other");
  const [title, setTitle] = useState("");
  const [issue, setIssue] = useState("");
  const [expiry, setExpiry] = useState("");
  const [notes, setNotes] = useState("");

  const typeName = (c: string) => types.find((t) => t.code === c)?.name_ar ?? c;
  const needsExpiry = types.find((t) => t.code === typeCode)?.requires_expiry ?? false;

  async function upload(file: File) {
    setErr(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      return setErr(`الحدّ ${MAX_MB} ميغابايت — هذا ${Math.round(file.size / 1048576)}.`);
    }
    if (needsExpiry && !expiry) return setErr("هذا النوع يتطلب تاريخ انتهاء.");

    setBusy("upload");
    const safe = file.name.replace(/[^\w.\-؀-ۿ ]/g, "_");
    const path = `employees/${employeeId}/${crypto.randomUUID()}-${safe}`;
    const { error: upErr } = await supabase.storage
      .from("employee-documents")
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) {
      setBusy(null);
      return setErr("تعذّر الرفع: " + upErr.message);
    }

    const { error: rowErr } = await supabase.from("employee_documents").insert({
      employee_id: employeeId,
      type_code: typeCode,
      title: title.trim() || null,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      issue_date: issue || null,
      expiry_date: expiry || null,
      notes: notes.trim() || null,
    });
    setBusy(null);
    if (rowErr) {
      await supabase.storage.from("employee-documents").remove([path]);
      return setErr("رُفع الملف ثم فشل حفظ بياناته، فأُزيل: " + rowErr.message);
    }
    setTitle("");
    setIssue("");
    setExpiry("");
    setNotes("");
    router.refresh();
  }

  async function open(doc: EmployeeDocument) {
    setBusy(doc.id);
    setErr(null);
    const { data, error } = await supabase.storage.from("employee-documents").createSignedUrl(doc.storage_path, 60);
    setBusy(null);
    if (error || !data) return setErr("تعذّر فتح الملف: " + (error?.message ?? ""));
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function hide(doc: EmployeeDocument) {
    if (!confirm(`إخفاء «${doc.file_name}»؟ يبقى محفوظاً في السجلّ ولا يُمحى.`)) return;
    setBusy(doc.id);
    const { error } = await supabase
      .from("employee_documents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", doc.id);
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  const input = "rounded border border-gray-300 px-2 py-1.5 text-xs";

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-gray-800">المستندات</h3>
        <span className="text-xs text-gray-400">خاصّة — تُفتح برابط ينتهي بعد دقيقة</span>
      </div>

      {err && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{err}</p>}

      {documents.length === 0 ? (
        <p className="text-sm text-gray-400">لا مستندات بعد.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {documents.map((d) => {
            const st = expiryState(d, today);
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{typeName(d.type_code)}</span>
                <button type="button" disabled={busy === d.id} onClick={() => open(d)}
                  className="font-medium text-brand-600 hover:underline disabled:opacity-50">
                  {d.title || d.file_name}
                </button>
                {st && <span className={`rounded px-1.5 py-0.5 text-[11px] ${st.cls}`}>{st.label}</span>}
                <span className="text-xs text-gray-400">
                  {d.uploaded_by_name ?? "—"} · <span dir="ltr">{d.created_at.slice(0, 10)}</span>
                </span>
                {canWrite && (
                  <button type="button" disabled={busy === d.id} onClick={() => hide(d)}
                    className="ms-auto text-xs text-gray-400 hover:text-red-600 disabled:opacity-50">
                    إخفاء
                  </button>
                )}
                {d.notes && <p className="w-full text-xs text-gray-500">{d.notes}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3 text-sm">
          <label className="text-[11px] text-gray-500">
            النوع
            <select value={typeCode} onChange={(e) => setTypeCode(e.target.value)} className={`${input} block`}>
              {active.map((t) => <option key={t.code} value={t.code}>{t.name_ar}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-gray-500">
            العنوان
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="اختياري" className={`${input} block`} />
          </label>
          <label className="text-[11px] text-gray-500">
            الإصدار
            <input type="date" dir="ltr" value={issue} onChange={(e) => setIssue(e.target.value)} className={`${input} block`} />
          </label>
          <label className="text-[11px] text-gray-500">
            الانتهاء{needsExpiry && <span className="text-red-500"> *</span>}
            <input type="date" dir="ltr" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={`${input} block`} />
          </label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظة (اختياري)"
            className={`${input} min-w-[8rem] flex-1`} />
          <label className="cursor-pointer rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
            {busy === "upload" ? "يرفع…" : "ارفع ملفاً"}
            <input type="file" className="hidden" disabled={busy !== null}
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) upload(f);
              }} />
          </label>
        </div>
      )}
    </div>
  );
}
