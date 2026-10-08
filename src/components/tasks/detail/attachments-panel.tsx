"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatBytes, friendlyTaskError, timeAgo } from "@/lib/tasks";
import type { TaskAttachment } from "@/lib/types";

const MAX = 25 * 1024 * 1024;
const BUCKET = "task-attachments";

// ============================================================
// المرفقات — الدلو الخاص task-attachments، المسار {task_id}/{uuid}-{اسم}.
// التحميل برابط موقَّع لدقائق (لا روابط عامّة). الرفع: الملف أولاً ثم
// صفّه؛ إن فشل الصفّ يُحذف الملف اليتيم.
// ============================================================
export default function AttachmentsPanel({
  taskId, attachments, canEdit, canUpload,
}: { taskId: string; attachments: TaskAttachment[]; canEdit: boolean; canUpload: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    setErr(null);
    for (const f of Array.from(files)) {
      if (f.size > MAX) {
        setErr(`«${f.name}» أكبر من ٢٥ ميغابايت.`);
        continue;
      }
      // مفاتيح التخزين لا تقبل غير ASCII: المسار آمن، والاسم الأصلي يُحفظ في الصفّ
      const safe = f.name.replace(/[^0-9A-Za-z._-]+/g, "_").replace(/^_+/, "").slice(-100) || "file";
      const path = `${taskId}/${crypto.randomUUID()}-${safe}`;
      const up = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) {
        console.error(up.error);
        setErr(`تعذّر رفع «${f.name}» — ${/mime|type/i.test(up.error.message) ? "نوع الملف غير مسموح." : "حاول مرة أخرى."}`);
        continue;
      }
      const { error } = await supabase.from("task_attachments").insert({
        task_id: taskId, storage_path: path, file_name: f.name.slice(0, 255), mime_type: f.type || null, size_bytes: f.size,
      });
      if (error) {
        console.error(error);
        await supabase.storage.from(BUCKET).remove([path]);
        setErr(friendlyTaskError(error));
      }
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  async function open(a: TaskAttachment) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.storage_path, 300);
    if (error || !data) return setErr("تعذّر فتح الملف.");
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function remove(a: TaskAttachment) {
    if (!confirm(`حذف «${a.file_name}»؟`)) return;
    const { data, error } = await supabase.rpc("task_attachment_remove", { p_id: a.id });
    if (error) return setErr(friendlyTaskError(error));
    if (data) await supabase.storage.from(BUCKET).remove([data as string]);
    router.refresh();
  }

  const icon = (m: string | null) =>
    m?.startsWith("image/") ? "image" : m?.startsWith("video/") ? "movie" : m === "application/pdf" ? "picture_as_pdf" : "description";

  return (
    <section className="dash-card p-4" aria-label="المرفقات">
      <h2 className="mb-2 flex items-center justify-between font-bold text-ink">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined">attach_file</span>
          المرفقات {attachments.length > 0 && <span className="text-xs font-normal text-gray-500">({attachments.length})</span>}
        </span>
        {canUpload && (
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 hover:border-brand-500 disabled:opacity-50">
            {busy ? "يُرفع…" : "+ أرفق ملفاً"}
          </button>
        )}
      </h2>
      <input ref={input} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)}
        accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" />
      <ul className="space-y-1.5">
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-gray-400">{icon(a.mime_type)}</span>
            <button type="button" onClick={() => open(a)} className="min-w-0 flex-1 truncate text-start text-sm text-brand-700 hover:underline">
              {a.file_name}
            </button>
            <span className="hidden text-[11px] text-gray-400 sm:inline">{formatBytes(a.size_bytes)} · {a.uploaded_by_name} · {timeAgo(a.created_at)}</span>
            {(a.mine || canEdit) && (
              <button type="button" onClick={() => remove(a)} aria-label={`حذف ${a.file_name}`} className="text-gray-300 hover:text-red-600">
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            )}
          </li>
        ))}
        {attachments.length === 0 && <li className="text-sm text-gray-400">لا مرفقات — صور، فيديو، تصاميم، PDF ومستندات حتى ٢٥ ميغابايت.</li>}
      </ul>
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
    </section>
  );
}
