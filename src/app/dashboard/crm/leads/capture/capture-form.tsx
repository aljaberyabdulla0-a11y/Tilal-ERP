"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { phoneKey } from "@/lib/clients-excel";
import { CHANNEL_OPTIONS } from "@/lib/leads-shared";

type Result = { intake_id: string; status: string; client_id: string | null; owner: string | null; reason: string | null };

// معرّف الطلب يُولَّد مرة لكل ليد: نقرتان أو انقطاع وإعادة إرسال = صفٌّ واحد
const newRequestId = () => crypto.randomUUID();

export default function CaptureForm({ campaigns, projects, canSelfAssign, selfAssignDefault }: {
  campaigns: { id: string; name: string; project_id: string | null }[];
  projects: { id: string; name: string }[];
  canSelfAssign: boolean;
  selfAssignDefault: boolean;
}) {
  const [requestId, setRequestId] = useState(newRequestId);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [channel, setChannel] = useState("");
  const [campaign, setCampaign] = useState("");
  const [project, setProject] = useState("");
  const [message, setMessage] = useState("");
  const [mine, setMine] = useState(selfAssignDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const phoneOk = !phone.trim() || phoneKey(phone) !== null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await createClient().rpc("lead_capture", {
      p_name: name, p_phone: phone, p_channel: channel,
      p_campaign_id: campaign || null,
      p_project_id: project || campaigns.find((c) => c.id === campaign)?.project_id || null,
      p_message: message || null, p_email: email || null,
      p_assign_to_me: mine, p_request_id: requestId,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setResult(data as Result);
  };

  const again = () => {
    setRequestId(newRequestId());
    setName(""); setPhone(""); setEmail(""); setMessage(""); setResult(null); setError(null);
  };

  if (result) {
    const tone = result.status === "مُحوَّل" || result.status === "مكرّر" ? "border-brand-200 bg-brand-50" : "border-amber-300 bg-amber-50";
    return (
      <div className={`space-y-3 rounded-lg border p-5 ${tone}`}>
        <p className="font-semibold text-gray-800">{describe(result)}</p>
        <div className="flex flex-wrap gap-2 text-sm">
          {result.client_id && (
            <Link href={`/dashboard/clients/${result.client_id}`} className="rounded border bg-white px-3 py-1.5 hover:bg-gray-50">فتح بطاقة العميل</Link>
          )}
          <button onClick={again} className="rounded bg-brand-600 px-3 py-1.5 font-semibold text-white">تسجيل ليد آخر</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border bg-white p-5">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="القناة التي وصل منها *">
          <select required value={channel} onChange={(e) => setChannel(e.target.value)} className="w-full rounded border px-2 py-2">
            <option value="">— اختر —</option>
            {CHANNEL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="الحملة (إن عُرفت)">
          <select value={campaign} onChange={(e) => setCampaign(e.target.value)} className="w-full rounded border px-2 py-2">
            <option value="">— بلا حملة —</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="الاسم">
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded border px-2 py-2" />
        </Field>
        <Field label="رقم الهاتف" hint={!phoneOk ? "ليس رقماً عراقياً صالحاً — سيُسجَّل في قائمة الأخطاء حتى يُصحَّح" : "بلا رقم؟ سجّله بالاسم ويُصحَّح لاحقاً"}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" placeholder="07XXXXXXXXX"
            className={`w-full rounded border px-2 py-2 ${phoneOk ? "" : "border-amber-400"}`} />
        </Field>
        <Field label="المشروع">
          <select value={project} onChange={(e) => setProject(e.target.value)} className="w-full rounded border px-2 py-2">
            <option value="">— من الحملة أو الموظف —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="البريد">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className="w-full rounded border px-2 py-2" />
        </Field>
      </div>
      <Field label="نصّ الرسالة / ما يطلبه">
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000} className="w-full rounded border px-2 py-2" />
      </Field>
      {canSelfAssign && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          سجّله باسمي (أنا من سيتابعه) — وإلا يُوزَّع بقواعد التوزيع
        </label>
      )}
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <button disabled={busy || !channel || (!name.trim() && !phone.trim())}
        className="rounded-lg bg-brand-600 px-5 py-2 font-semibold text-white disabled:opacity-50">
        {busy ? "يُسجَّل…" : "سجّل الليد"}
      </button>
    </form>
  );
}

function describe(r: Result): string {
  switch (r.status) {
    case "مُحوَّل":
      return r.owner ? `سُجّل عميلاً جديداً وأُسند إلى ${r.owner}.` : "سُجّل عميلاً جديداً — بانتظار التوزيع، وسيُنبَّه الموزّعون إن تأخّر.";
    case "مكرّر":
      return `العميل موجود (${r.reason ?? "مطابقة"})${r.owner ? ` لدى ${r.owner}` : ""}: رُبط هذا الوصول ببطاقته، ونُبّه صاحبها ليتواصل اليوم.`;
    case "مرفوض":
      return `سُجّل في قائمة الأخطاء: ${r.reason ?? "بيانات ناقصة"}. لن يضيع — يُصحَّح من مركز الليدات.`;
    default:
      return `سُجّل، وتعذّرت معالجته الآن (${r.reason ?? r.status}). سيُعاد تلقائياً خلال دقائق.`;
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-gray-600">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}
