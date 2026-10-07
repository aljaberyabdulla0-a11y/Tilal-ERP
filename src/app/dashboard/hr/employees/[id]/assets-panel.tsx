"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Asset = { id: string; asset_type: string; description: string; asset_tag: string | null; serial_no: string | null;
  assigned_date: string; returned_date: string | null; condition_in: string | null; status: string };

const TYPES = ["حاسوب", "هاتف", "كاميرا", "مركبة", "شريحة", "مفاتيح", "بطاقة دخول", "أخرى"];

// العهد (sql/162): ما سُلِّم للموظف وإعادته — إخلاء الطرف (163) يقرؤها.
export default function AssetsPanel({ employeeId, assets, canEdit }: { employeeId: string; assets: Asset[]; canEdit: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [f, setF] = useState({ type: "حاسوب", description: "", tag: "", serial: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setErr(null);
    const { error } = await fn();
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  const out = assets.filter((a) => a.status === "مسلَّمة").length;
  const input = "rounded border border-gray-300 px-2 py-1 text-xs";

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">العهد</h3>
        <span className={`text-xs ${out ? "text-amber-600" : "text-gray-400"}`}>{out} لدى الموظف</span>
      </div>
      {err && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{err}</p>}
      {assets.length === 0 ? (
        <p className="text-sm text-gray-400">لا عهد.</p>
      ) : (
        <ul className="divide-y text-sm">
          {assets.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-center gap-2 py-2 ${a.status !== "مسلَّمة" ? "text-gray-400" : ""}`}>
              <span className="rounded bg-gray-100 px-1.5 text-xs">{a.asset_type}</span>
              <span>{a.description}</span>
              {a.asset_tag && <span className="font-mono text-[11px]" dir="ltr">{a.asset_tag}</span>}
              <span className="text-[11px]" dir="ltr">{a.assigned_date}{a.returned_date ? ` → ${a.returned_date}` : ""}</span>
              <span className="text-[11px]">{a.status}{a.condition_in ? ` · ${a.condition_in}` : ""}</span>
              {canEdit && a.status === "مسلَّمة" && (
                <span className="ms-auto flex gap-2 text-[11px]">
                  <button disabled={busy} className="text-green-700 hover:underline"
                    onClick={() => {
                      const cond = prompt("حالتها عند الإعادة:", "سليمة");
                      if (cond !== null) run(() => supabase.from("employee_assets").update({
                        status: "مُعادة", returned_date: today, condition_in: cond || null,
                      }).eq("id", a.id));
                    }}>أُعيدت</button>
                  <button disabled={busy} className="text-red-600 hover:underline"
                    onClick={() => confirm("تسجيلها مفقودة؟") && run(() => supabase.from("employee_assets").update({
                      status: "مفقودة", returned_date: today,
                    }).eq("id", a.id))}>مفقودة</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded bg-gray-50 p-2 sm:grid-cols-5">
          <select className={input} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className={`${input} sm:col-span-2`} placeholder="الوصف" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <input className={input} dir="ltr" placeholder="رقم العهدة" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} />
          <button disabled={busy || !f.description} className="rounded bg-brand-600 py-1 text-xs text-white disabled:opacity-40"
            onClick={() => run(() => supabase.from("employee_assets").insert({
              employee_id: employeeId, asset_type: f.type, description: f.description.trim(),
              asset_tag: f.tag || null, serial_no: f.serial || null,
            })).then(() => setF({ ...f, description: "", tag: "" }))}>
            تسليم عهدة
          </button>
        </div>
      )}
    </div>
  );
}
