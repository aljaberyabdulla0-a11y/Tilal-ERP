"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/components/marketing/record-form";
import { AssetDownload } from "../assets/uploader";

// ============================================================
// The expense invoice — an asset of type «فاتورة» in the private marketing bucket, attached to the
// expense (invoice_asset_id). Marketing uploads it with the request, and finance sees it before paying (195 §10).
// ============================================================
export default function ExpenseInvoice({ expenseId, code, path, canAttach, campaignId, projectId }: {
  expenseId: string; code: string; path: string | null; canAttach: boolean;
  campaignId: string | null; projectId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setErr(null);
    if (file.size > 20 * 1024 * 1024) return setErr("الحدّ ٢٠ ميغابايت للفاتورة.");
    setBusy(true);
    const supabase = createClient();
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const storagePath = `mkt/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from("marketing-assets").upload(storagePath, file, { contentType: file.type, upsert: false });
    if (up.error) { setBusy(false); return setErr(up.error.message); }
    const { data: asset, error } = await supabase.from("mkt_assets").insert({
      title: `فاتورة ${code}`, asset_type: "فاتورة", folder: "فواتير المصروفات", tags: [code],
      campaign_id: campaignId, project_id: projectId,
      storage_path: storagePath, file_name: file.name, mime_type: file.type || null, size_bytes: file.size,
    }).select("id").single();
    if (error || !asset) { setBusy(false); return setErr(friendlyError(error?.message ?? "تعذّر", error?.code)); }
    const link = await supabase.from("mkt_expenses").update({ invoice_asset_id: asset.id }).eq("id", expenseId);
    setBusy(false);
    if (link.error) return setErr(friendlyError(link.error.message, link.error.code));
    router.refresh();
  }

  return (
    <span className="flex flex-col text-xs">
      {path && <span className="flex items-center gap-1"><span className="text-gray-500">الفاتورة:</span><AssetDownload path={path} /></span>}
      {canAttach && (
        <label className="cursor-pointer text-brand-600 hover:underline">
          {busy ? "يرفع…" : path ? "استبدل الفاتورة" : "أرفق الفاتورة"}
          <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        </label>
      )}
      {err && <span className="text-red-600">{err}</span>}
    </span>
  );
}
