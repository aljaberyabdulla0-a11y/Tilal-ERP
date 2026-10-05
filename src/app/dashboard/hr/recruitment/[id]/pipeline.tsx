"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/types";
import {
  CANDIDATE_SOURCES,
  Candidate,
  FINAL_STAGES,
  JobApplication,
  JobInterview,
  JobOffer,
  JobOpening,
  OFFER_STYLE,
  PIPELINE_STAGES,
} from "@/lib/recruitment";

type Person = { id: string; full_name: string; employee_code: string };

// مسار المرشحين لوظيفة واحدة. كل قرار يمرّ بالقاعدة: حرّاس المراحل
// (guard_job_application)، ودوالّ العرض والتعيين — والرسالة تظهر كما هي.
export default function Pipeline(props: {
  opening: JobOpening;
  applications: JobApplication[];
  candidates: Candidate[];
  interviews: JobInterview[];
  offers: JobOffer[];
  expected: Record<string, number | null>;
  people: Person[];
  canManage: boolean;
  isAdmin: boolean;
  myUserId: string;
}) {
  const { opening, applications, canManage } = props;
  const [showFinal, setShowFinal] = useState(false);

  const stages = [...PIPELINE_STAGES, ...(showFinal ? FINAL_STAGES : [])] as string[];
  const finalCount = applications.filter((a) => (FINAL_STAGES as readonly string[]).includes(a.stage)).length;

  return (
    <div className="space-y-4">
      {canManage && opening.status === "مفتوحة" && <AddCandidate openingId={opening.id} />}

      {applications.length === 0 && (
        <p className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-gray-400">لا مرشحين بعد.</p>
      )}

      {stages.map((stage) => {
        const items = applications.filter((a) => a.stage === stage);
        if (items.length === 0) return null;
        return (
          <div key={stage}>
            <h3 className="mb-2 text-sm font-semibold text-gray-600">
              {stage} <span className="text-gray-400">({items.length})</span>
            </h3>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {items.map((a) => (
                <ApplicationCard key={a.id} app={a} {...props} />
              ))}
            </div>
          </div>
        );
      })}

      {finalCount > 0 && (
        <button onClick={() => setShowFinal(!showFinal)} className="text-sm text-brand-700 hover:underline">
          {showFinal ? "إخفاء المنتهية" : `إظهار المنتهية (${finalCount})`}
        </button>
      )}
    </div>
  );
}

function AddCandidate({ openingId }: { openingId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ full_name: "", phone: "", email: "", source: "أخرى", current_title: "", expected_salary: "", notes: "" });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("add_candidate_to_opening", { p_opening: openingId, p: f });
    setBusy(false);
    if (error) return setErr(error.message);
    setOpen(false);
    setF({ full_name: "", phone: "", email: "", source: "أخرى", current_title: "", expected_salary: "", notes: "" });
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
        + مرشح
      </button>
    );
  }
  const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  return (
    <form onSubmit={save} className="grid grid-cols-1 gap-3 rounded-2xl border bg-white p-5 shadow-sm sm:grid-cols-3">
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700 sm:col-span-3">{err}</p>}
      <label className="text-xs text-gray-600">الاسم *<input className={input} required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
      <label className="text-xs text-gray-600">الهاتف<input className={input} dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
      <label className="text-xs text-gray-600">البريد<input className={input} dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="text-xs text-gray-600">
        المصدر
        <select className={input} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          {CANDIDATE_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="text-xs text-gray-600">المسمّى الحالي<input className={input} value={f.current_title} onChange={(e) => setF({ ...f, current_title: e.target.value })} /></label>
      <label className="text-xs text-gray-600">الراتب المتوقّع<input className={input} type="number" min="0" dir="ltr" value={f.expected_salary} onChange={(e) => setF({ ...f, expected_salary: e.target.value })} /></label>
      <label className="text-xs text-gray-600 sm:col-span-3">ملاحظات<input className={input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <p className="text-[11px] text-gray-400 sm:col-span-3">مرشح بالرقم نفسه يُعاد استعماله ولا يُكرَّر.</p>
      <div className="flex gap-2 sm:col-span-3">
        <button disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">إضافة</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-4 py-2 text-sm text-gray-600">إلغاء</button>
      </div>
    </form>
  );
}

function ApplicationCard({
  app,
  candidates,
  interviews,
  offers,
  expected,
  people,
  canManage,
  isAdmin,
  myUserId,
}: {
  app: JobApplication;
  candidates: Candidate[];
  interviews: JobInterview[];
  offers: JobOffer[];
  expected: Record<string, number | null>;
  people: Person[];
  canManage: boolean;
  isAdmin: boolean;
  myUserId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [panel, setPanel] = useState<"" | "interview" | "offer">("");

  const c = candidates.find((x) => x.id === app.candidate_id);
  const ivs = interviews.filter((i) => i.application_id === app.id);
  const offs = offers.filter((o) => o.application_id === app.id);
  const live = offs.find((o) => ["بانتظار الاعتماد", "معتمد", "مقبول"].includes(o.status));
  const final = (FINAL_STAGES as readonly string[]).includes(app.stage);
  const name = (id: string) => people.find((p) => p.id === id)?.full_name ?? "—";

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setErr(null);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      setErr(error.message);
      return false;
    }
    router.refresh();
    return true;
  }

  function move(stage: string) {
    let reason: string | null = null;
    if (stage === "مرفوض" || stage === "انسحب") {
      reason = prompt(stage === "مرفوض" ? "سبب الرفض:" : "سبب الانسحاب (اختياري):");
      if (stage === "مرفوض" && !reason) return;
    }
    run(() =>
      supabase.from("job_applications")
        .update({ stage, ...(reason ? { rejection_reason: reason } : {}) })
        .eq("id", app.id)
    );
  }

  async function uploadCv(file: File) {
    if (!c) return;
    if (file.size > 10 * 1024 * 1024) return setErr("الحدّ 10 ميغابايت.");
    const safe = file.name.replace(/[^\w.\-؀-ۿ ]/g, "_");
    const path = `candidates/${c.id}/${crypto.randomUUID()}-${safe}`;
    setBusy(true);
    const { error: upErr } = await supabase.storage.from("recruitment").upload(path, file, { contentType: file.type || undefined });
    if (upErr) {
      setBusy(false);
      return setErr("تعذّر الرفع: " + upErr.message);
    }
    const { error } = await supabase.from("candidates").update({ cv_path: path, cv_file_name: file.name }).eq("id", c.id);
    setBusy(false);
    if (error) {
      await supabase.storage.from("recruitment").remove([path]);
      return setErr(error.message);
    }
    router.refresh();
  }

  async function openCv() {
    if (!c?.cv_path) return;
    const { data, error } = await supabase.storage.from("recruitment").createSignedUrl(c.cv_path, 60);
    if (error || !data) return setErr("تعذّر فتح السيرة: " + (error?.message ?? ""));
    window.open(data.signedUrl, "_blank", "noopener");
  }

  const small = "rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50";

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-800">{c?.full_name ?? "—"}</p>
          <p className="text-xs text-gray-500">
            {[c?.current_title, c?.source].filter(Boolean).join(" · ")}
            {canManage && expected[app.candidate_id] != null && <> · يتوقّع <span dir="ltr">{formatPrice(expected[app.candidate_id]!)}</span></>}
          </p>
          {(c?.phone || c?.email) && (
            <p className="text-xs text-gray-400" dir="ltr">{[c?.phone, c?.email].filter(Boolean).join(" · ")}</p>
          )}
          {app.rejection_reason && <p className="mt-1 text-xs text-red-600">{app.rejection_reason}</p>}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {c?.cv_path ? (
            <button onClick={openCv} className="text-brand-700 hover:underline">السيرة الذاتية</button>
          ) : (
            canManage && !final && (
              <label className="cursor-pointer text-brand-700 hover:underline">
                رفع السيرة
                <input type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadCv(f); }} />
              </label>
            )
          )}
          {app.employee_id && (
            <Link href={`/dashboard/hr/employees/${app.employee_id}`} className="rounded bg-green-100 px-2 py-0.5 text-green-700">
              ملف الموظف ←
            </Link>
          )}
        </div>
      </div>

      {err && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{err}</p>}

      {ivs.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t pt-2 text-xs">
          {ivs.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2">
              <span className="text-gray-500">جولة {i.round}</span>
              <span dir="ltr">{i.scheduled_at.slice(0, 16).replace("T", " ")}</span>
              <span>{name(i.interviewer_id)}</span>
              <span className="rounded bg-gray-100 px-1.5">{i.status}</span>
              {i.score != null && <span className="font-semibold">{i.score}/5 · {i.recommendation}</span>}
              {i.feedback && <span className="w-full text-gray-500">{i.feedback}</span>}
              {canManage && i.status === "مجدولة" && (
                <button disabled={busy} className="text-gray-400 hover:text-red-600"
                  onClick={() => run(() => supabase.from("job_interviews").update({ status: "ألغيت" }).eq("id", i.id))}>
                  إلغاء
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {offs.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t pt-2 text-xs">
          {offs.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-gray-400" dir="ltr">{o.offer_no}</span>
              <span dir="ltr" className="font-semibold">{formatPrice(o.salary)}</span>
              <span>يباشر {o.start_date} · تجربة {o.probation_months} أشهر</span>
              <span className={`rounded px-1.5 ${OFFER_STYLE[o.status] ?? "bg-gray-100"}`}>{o.status}</span>
              {o.decision_note && <span className="text-gray-500">{o.decision_note}</span>}
              {o.status === "بانتظار الاعتماد" && isAdmin && o.created_by !== myUserId && (
                <>
                  <button disabled={busy} className={small}
                    onClick={() => run(() => supabase.rpc("decide_offer", { p_id: o.id, p_approve: true, p_note: null }))}>اعتماد</button>
                  <button disabled={busy} className={small}
                    onClick={() => { const n = prompt("سبب الرفض:"); if (n) run(() => supabase.rpc("decide_offer", { p_id: o.id, p_approve: false, p_note: n })); }}>رفض</button>
                </>
              )}
              {o.status === "معتمد" && canManage && (
                <>
                  <button disabled={busy} className={small}
                    onClick={() => run(() => supabase.rpc("record_offer_response", { p_id: o.id, p_accepted: true, p_note: null }))}>قبِل المرشح</button>
                  <button disabled={busy} className={small}
                    onClick={() => { const n = prompt("ملاحظة (اختياري):") ?? ""; run(() => supabase.rpc("record_offer_response", { p_id: o.id, p_accepted: false, p_note: n || null })); }}>رفض المرشح</button>
                </>
              )}
              {["بانتظار الاعتماد", "معتمد"].includes(o.status) && canManage && (
                <button disabled={busy} className="text-gray-400 hover:text-red-600"
                  onClick={() => { const n = prompt("سبب السحب:"); if (n) run(() => supabase.rpc("withdraw_offer", { p_id: o.id, p_note: n })); }}>سحب</button>
              )}
              {o.status === "مقبول" && canManage && !app.employee_id && (
                <button disabled={busy} className="rounded bg-green-600 px-2.5 py-1 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  onClick={() => {
                    const d = prompt("تاريخ المباشرة (YYYY-MM-DD):", o.start_date);
                    if (d) run(() => supabase.rpc("hire_candidate", { p_application: app.id, p_hire_date: d }));
                  }}>
                  تعيين ← موظف
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && !final && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2">
          <select value="" disabled={busy} onChange={(e) => e.target.value && move(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-xs">
            <option value="">نقل إلى…</option>
            {[...PIPELINE_STAGES, "مرفوض", "انسحب"].filter((s) => s !== app.stage).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className={small} onClick={() => setPanel(panel === "interview" ? "" : "interview")}>+ مقابلة</button>
          {app.stage === "عرض" && !live && (
            <button className={small} onClick={() => setPanel(panel === "offer" ? "" : "offer")}>+ عرض</button>
          )}
        </div>
      )}

      {panel === "interview" && (
        <InterviewForm appId={app.id} round={ivs.length + 1} people={people} onDone={() => setPanel("")} />
      )}
      {panel === "offer" && <OfferForm appId={app.id} onDone={() => setPanel("")} />}
    </div>
  );
}

function InterviewForm({ appId, round, people, onDone }: { appId: string; round: number; people: Person[]; onDone: () => void }) {
  const router = useRouter();
  const supabase = createClient();
  const [f, setF] = useState({ when: "", interviewer_id: "", mode: "حضوري", location: "" });
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { error } = await supabase.from("job_interviews").insert({
      application_id: appId,
      round,
      scheduled_at: new Date(f.when).toISOString(),
      interviewer_id: f.interviewer_id,
      mode: f.mode,
      location: f.location.trim() || null,
    });
    if (error) return setErr(error.message);
    onDone();
    router.refresh();
  }

  const input = "w-full rounded border border-gray-300 px-2 py-1.5 text-xs";
  return (
    <form onSubmit={save} className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3">
      {err && <p className="col-span-2 text-xs text-red-600">{err}</p>}
      <label className="text-[11px] text-gray-600">الموعد *<input className={input} type="datetime-local" dir="ltr" required value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></label>
      <label className="text-[11px] text-gray-600">
        المقيِّم *
        <select className={input} required value={f.interviewer_id} onChange={(e) => setF({ ...f, interviewer_id: e.target.value })}>
          <option value="">—</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </label>
      <label className="text-[11px] text-gray-600">
        الطريقة
        <select className={input} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
          {["حضوري", "هاتف", "فيديو"].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className="text-[11px] text-gray-600">المكان / الرابط<input className={input} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></label>
      <button className="col-span-2 rounded bg-brand-600 py-1.5 text-xs font-semibold text-white">جدولة — يُنبَّه المقيِّم</button>
    </form>
  );
}

function OfferForm({ appId, onDone }: { appId: string; onDone: () => void }) {
  const router = useRouter();
  const supabase = createClient();
  const [f, setF] = useState({ salary: "", start_date: "", probation_months: "3", notes: "" });
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { error } = await supabase.from("job_offers").insert({
      application_id: appId,
      salary: Number(f.salary),
      start_date: f.start_date,
      probation_months: Number(f.probation_months),
      notes: f.notes.trim() || null,
    });
    if (error) return setErr(error.message);
    onDone();
    router.refresh();
  }

  const input = "w-full rounded border border-gray-300 px-2 py-1.5 text-xs";
  return (
    <form onSubmit={save} className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-gray-50 p-3">
      {err && <p className="col-span-3 text-xs text-red-600">{err}</p>}
      <label className="text-[11px] text-gray-600">الراتب (د.ع) *<input className={input} type="number" min="0" dir="ltr" required value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value })} /></label>
      <label className="text-[11px] text-gray-600">المباشرة *<input className={input} type="date" dir="ltr" required value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></label>
      <label className="text-[11px] text-gray-600">أشهر التجربة<input className={input} type="number" min="0" max="12" dir="ltr" value={f.probation_months} onChange={(e) => setF({ ...f, probation_months: e.target.value })} /></label>
      <label className="col-span-3 text-[11px] text-gray-600">ملاحظات<input className={input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <p className="col-span-3 text-[11px] text-gray-400">يذهب للمدير للاعتماد — ولا يعتمده من أعدّه.</p>
      <button className="col-span-3 rounded bg-brand-600 py-1.5 text-xs font-semibold text-white">إعداد العرض</button>
    </form>
  );
}
