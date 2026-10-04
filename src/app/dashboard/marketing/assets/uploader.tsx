"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/components/marketing/record-form";

// ============================================================
// رفع أصل — نمط مستندات العميل (087): الدلو خاصّ، والمسار
// mkt/<uuid>-<اسم الملف>، والتنزيل برابط موقَّع ينتهي بدقيقة.
// الملفّ لا يُستبدَل: نسخةٌ جديدة تشير إلى سابقتها.
// ============================================================
type Opt = { id: string; name: string };

export function AssetUploader({ types, projects, campaigns, activities, parent }: {
  types: readonly string[]; projects: Opt[]; campaigns: Opt[]; activities: Opt[];
  parent?: { id: string; title: string; asset_type: string; version: number; project_id: string | null; campaign_id: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({
    title: parent?.title ?? "", asset_type: parent?.asset_type ?? types[0], folder: "", tags: "",
    project_id: parent?.project_id ?? "", campaign_id: parent?.campaign_id ?? "", activity_id: "",
    usage_rights: "", copyright: "", expires_on: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload() {
    setErr(null);
    if (!file) return setErr("اختر ملفّاً.");
    if (!f.title.trim()) return setErr("العنوان مطلوب.");
    if (file.size > 100 * 1024 * 1024) return setErr("الحدّ ١٠٠ ميغابايت.");
    setBusy(true);
    const supabase = createClient();
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `mkt/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from("marketing-assets").upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { setBusy(false); return setErr(up.error.message); }
    const { error } = await supabase.from("mkt_assets").insert({
      title: f.title.trim(), asset_type: f.asset_type, folder: f.folder.trim() || null,
      tags: f.tags.split(/[،,]/).map((t) => t.trim()).filter(Boolean),
      project_id: f.project_id || null, campaign_id: f.campaign_id || null, activity_id: f.activity_id || null,
      storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size,
      version: parent ? parent.version + 1 : 1, parent_asset_id: parent?.id ?? null,
      usage_rights: f.usage_rights.trim() || null, copyright: f.copyright.trim() || null, expires_on: f.expires_on || null,
    });
    if (!error && parent) await supabase.from("mkt_assets").update({ status: "مؤرشف", archived_at: new Date().toISOString() }).eq("id", parent.id);
    setBusy(false);
    if (error) return setErr(friendlyError(error.message, error.code));
    setOpen(false);
    setFile(null);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className={parent ? "text-xs text-brand-600 hover:underline" : "flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3.5 py-2 text-sm font-semibold text-brand-700"}>
        {parent ? "نسخة جديدة" : <><span className="material-symbols-outlined text-[18px]">upload</span>ارفع أصلاً</>}
      </button>
    );
  }
  const inp = "mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5";
  return (
    <div className="rounded-lg border border-brand-200 bg-white p-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="sm:col-span-3"><span className="text-xs text-gray-500">الملف</span>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block" /></label>
        <label className="sm:col-span-2"><span className="text-xs text-gray-500">العنوان *</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={inp} /></label>
        <label><span className="text-xs text-gray-500">النوع</span><select value={f.asset_type} onChange={(e) => setF({ ...f, asset_type: e.target.value })} className={inp}>{types.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">المجلّد</span><input value={f.folder} onChange={(e) => setF({ ...f, folder: e.target.value })} placeholder="لاماك/الإطلاق" className={inp} /></label>
        <label className="sm:col-span-2"><span className="text-xs text-gray-500">وسوم (بفاصلة)</span><input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} className={inp} /></label>
        <label><span className="text-xs text-gray-500">المشروع</span><select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })} className={inp}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">الحملة</span><select value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })} className={inp}><option value="">—</option>{campaigns.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">النشاط</span><select value={f.activity_id} onChange={(e) => setF({ ...f, activity_id: e.target.value })} className={inp}><option value="">—</option>{activities.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">حقوق الاستخدام</span><input value={f.usage_rights} onChange={(e) => setF({ ...f, usage_rights: e.target.value })} placeholder="داخلي / إعلانات مدفوعة / حتى ٢٠٢٧" className={inp} /></label>
        <label><span className="text-xs text-gray-500">الملكية الفكرية</span><input value={f.copyright} onChange={(e) => setF({ ...f, copyright: e.target.value })} className={inp} /></label>
        <label><span className="text-xs text-gray-500">تنتهي صلاحيته</span><input type="date" value={f.expires_on} onChange={(e) => setF({ ...f, expires_on: e.target.value })} dir="ltr" className={inp} /></label>
      </div>
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy} onClick={upload} className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? "يرفع…" : "ارفع"}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-4 py-2">إلغاء</button>
      </div>
    </div>
  );
}

export function AssetDownload({ path }: { path: string }) {
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    const { data, error } = await createClient().storage.from("marketing-assets").createSignedUrl(path, 60);
    if (error || !data) return setErr(error?.message ?? "تعذّر");
    window.open(data.signedUrl, "_blank", "noopener");
  }
  return (
    <span>
      <button type="button" onClick={go} className="text-xs text-brand-600 hover:underline">تنزيل</button>
      {err && <span className="block text-xs text-red-600">{err}</span>}
    </span>
  );
}

export function AttachToContent({ contentId, assetId }: { contentId: string; assetId: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  async function go() {
    const { error } = await createClient().from("mkt_content_assets").insert({ content_id: contentId, asset_id: assetId });
    if (!error || error.code === "23505") { setDone(true); router.refresh(); }
  }
  return done ? <span className="text-xs text-brand-700">أُرفق</span>
    : <button type="button" onClick={go} className="text-xs text-brand-600 hover:underline">أرفق بالمحتوى</button>;
}
