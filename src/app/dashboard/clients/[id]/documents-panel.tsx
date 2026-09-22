"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ClientDocument } from "@/lib/crm";

// ============================================================
// مستندات العميل (sql/087).
//
// الملفّ **خاصّ دائماً**: الدلو غير عامّ، والتحميل برابط موقَّع ينتهي
// بعد دقيقة. هوية المشتري وعقده لا يُنشران برابط دائم يُخمَّن —
// ولذلك لا يوجد هنا رابط ثابت يُنسخ، بل زرٌّ يفتح رابطاً يموت.
//
// والحذف **ناعم**: عقدٌ رُفع ثم حُذف قد يكون هو الدليل يوماً. يختفي
// من الشاشة ويبقى في التخزين وفي سجلّ التدقيق.
// ============================================================
const DOC_TYPES = ["هوية", "عقد", "إيصال", "مخطّط", "عرض سعر", "آخر"];
const MAX_MB = 20;

export default function DocumentsPanel({
  clientId,
  documents,
  canWrite,
}: {
  clientId: string;
  documents: ClientDocument[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [notes, setNotes] = useState("");

  async function upload(file: File) {
    setErr(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      return setErr(`الحدّ ${MAX_MB} ميغابايت — هذا ${Math.round(file.size / 1048576)}.`);
    }

    setBusy("upload");
    // المسار هو الحارس: سياسة التخزين تستخرج منه معرّف العميل
    const safe = file.name.replace(/[^\w.\-؀-ۿ ]/g, "_");
    const path = `clients/${clientId}/${crypto.randomUUID()}-${safe}`;

    const { error: upErr } = await supabase.storage
      .from("client-documents")
      .upload(path, file, { contentType: file.type || undefined, upsert: false });

    if (upErr) {
      setBusy(null);
      return setErr("تعذّر الرفع: " + upErr.message);
    }

    const { error: rowErr } = await supabase.from("client_documents").insert({
      client_id: clientId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      doc_type: docType,
      notes: notes.trim() || null,
    });

    setBusy(null);
    if (rowErr) {
      // الصفّ فشل فلا نترك ملفّاً يتيماً في التخزين
      await supabase.storage.from("client-documents").remove([path]);
      return setErr("رُفع الملفّ ثم فشل حفظ بياناته، فأُزيل: " + rowErr.message);
    }
    setNotes("");
    router.refresh();
  }

  // رابط موقَّع لدقيقة — لا رابط دائم
  async function open(doc: ClientDocument) {
    setBusy(doc.id);
    setErr(null);
    const { data, error } = await supabase.storage
      .from("client-documents")
      .createSignedUrl(doc.storage_path, 60);
    setBusy(null);
    if (error || !data) return setErr("تعذّر فتح الملفّ: " + (error?.message ?? ""));
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function softDelete(doc: ClientDocument) {
    if (!confirm(`إخفاء «${doc.file_name}»؟ يبقى محفوظاً في السجلّ ولا يُمحى.`)) return;
    setBusy(doc.id);
    const { error } = await supabase
      .from("client_documents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", doc.id);
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  const fmtSize = (n: number | null) =>
    n === null ? "—" : n < 1024 * 1024 ? `${Math.round(n / 1024)} كب` : `${(n / 1048576).toFixed(1)} مب`;

  if (!canWrite && documents.length === 0) return null;

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-500">المستندات</p>
        <span className="text-xs text-gray-400">خاصّة — تُفتح برابط ينتهي بعد دقيقة</span>
      </div>

      {err && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{err}</p>}

      {documents.length > 0 ? (
        <ul className="mt-2 divide-y divide-gray-100">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{d.doc_type}</span>
              <button
                type="button"
                disabled={busy === d.id}
                onClick={() => open(d)}
                className="font-medium text-brand-600 hover:underline disabled:opacity-50"
              >
                {d.file_name}
              </button>
              <span className="text-xs text-gray-400">{fmtSize(d.size_bytes)}</span>
              <span className="text-xs text-gray-400">
                {d.uploaded_by_name ?? "—"} · <span dir="ltr">{d.created_at.slice(0, 10)}</span>
              </span>
              {canWrite && (
                <button
                  type="button"
                  disabled={busy === d.id}
                  onClick={() => softDelete(d)}
                  className="ms-auto text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                >
                  إخفاء
                </button>
              )}
              {d.notes && <p className="w-full text-xs text-gray-500">{d.notes}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-gray-400">لا مستندات بعد.</p>
      )}

      {canWrite && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-xs"
          >
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظة (اختياري)"
            className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs"
          />
          <label className="cursor-pointer rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
            {busy === "upload" ? "يرفع…" : "ارفع ملفاً"}
            <input
              type="file"
              className="hidden"
              disabled={busy !== null}
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) upload(f);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
