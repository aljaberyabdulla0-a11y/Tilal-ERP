"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ProjectLite, Source } from "@/lib/crm";

// ============================================================
// إضافة حملة وتحديث مصروفها.
//
// المصروف حقلٌ يُحدَّث دورياً لا مرة واحدة: الحملة تعمل والمصروف
// يتراكم. ولذلك يظهر تعديله في الجدول نفسه بلا فتح نموذج.
// ============================================================
const MEDIUMS = ["إعلان مدفوع", "عضوي", "بريد", "رسائل", "فعالية", "إحالة", "آخر"];

export default function CampaignForm({
  sources,
  projects,
}: {
  sources: Source[];
  projects: ProjectLite[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    name: "",
    source_id: "",
    project_id: "",
    medium: MEDIUMS[0],
    content: "",
    start_date: "",
    end_date: "",
    budget: "",
    spent: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  async function save() {
    setErr(null);
    if (!f.name.trim()) return setErr("اسم الحملة — وهو ما يُنسب إليه الليد.");
    const budget = num(f.budget);
    const spent = num(f.spent);
    if ((budget !== null && (!Number.isFinite(budget) || budget < 0)) ||
        (spent !== null && (!Number.isFinite(spent) || spent < 0))) {
      return setErr("الميزانية والمصروف أرقام موجبة.");
    }
    if (f.start_date && f.end_date && f.end_date < f.start_date) {
      return setErr("تاريخ الانتهاء قبل البداية.");
    }

    setBusy(true);
    const { error } = await supabase.from("crm_campaigns").insert({
      name: f.name.trim(),
      source_id: f.source_id || null,
      project_id: f.project_id || null,
      medium: f.medium || null,
      content: f.content.trim() || null,
      start_date: f.start_date || null,
      end_date: f.end_date || null,
      budget,
      spent,
    });
    setBusy(false);
    if (error) return setErr(error.code === "23505" ? "توجد حملة بهذا الاسم." : error.message);
    setOpen(false);
    setF({ ...f, name: "", content: "", budget: "", spent: "" });
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 px-3.5 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
      >
        <span className="material-symbols-outlined text-[18px]">campaign</span>
        حملة جديدة
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-brand-200 bg-white p-4">
      <p className="font-semibold text-gray-800">حملة جديدة</p>
      <p className="text-xs text-gray-500">
        املأ المصروف — بدونه تبقى كلفة الليد والاستحواذ فارغة، وهو الصواب: لا نعرفها.
      </p>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className="text-xs text-gray-500">اسم الحملة</span>
          <input value={f.name} onChange={(e) => set("name", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" placeholder="لاماك — سبتمبر ٢٠٢٦" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">الوسيط</span>
          <select value={f.medium} onChange={(e) => set("medium", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
            {MEDIUMS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-gray-500">المصدر</span>
          <select value={f.source_id} onChange={(e) => set("source_id", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
            <option value="">—</option>
            {sources.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">المشروع</span>
          <select value={f.project_id} onChange={(e) => set("project_id", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
            <option value="">—</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">تمييز الإعلان (اختياري)</span>
          <input value={f.content} onChange={(e) => set("content", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" placeholder="فيديو ٣٠ث" />
        </label>

        <label className="block">
          <span className="text-xs text-gray-500">من</span>
          <input type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">إلى</span>
          <input type="date" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-gray-500">الميزانية</span>
            <input type="number" value={f.budget} onChange={(e) => set("budget", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">المصروف</span>
            <input type="number" value={f.spent} onChange={(e) => set("spent", e.target.value)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" dir="ltr" />
          </label>
        </div>

        {err && <p className="text-xs text-red-700 sm:col-span-3">{err}</p>}
        <div className="flex gap-2 sm:col-span-3">
          <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? "يحفظ…" : "أضف الحملة"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
