"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// نموذج الليد العام. الزيارة تُسجَّل من المتصفّح بعد التحميل (لا من الخادم)
// فلا يُعدّ زاحفو المعاينة زوّاراً. والحقل المخفي «website» فخٌّ للروبوتات.
export default function LeadForm({
  slug, cta, thankYou, askBudget, askTimeline, visitor, utm, linkCode,
}: {
  slug: string; cta: string; thankYou: string; askBudget: boolean; askTimeline: boolean;
  visitor: string | null; utm: Record<string, string>; linkCode: string | null;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [budget, setBudget] = useState("");
  const [timeline, setTimeline] = useState("");
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const dev = /ipad|tablet/i.test(ua) ? "لوحي" : /mobi|android|iphone/i.test(ua) ? "جوال" : "حاسوب";
    createClient().rpc("mkt_track_view", { p_slug: slug, p_visitor: visitor, p_device: dev, p_utm: utm, p_link_code: linkCode }).then(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { data, error } = await createClient().rpc("mkt_submit_lead", {
      p_slug: slug, p_name: name, p_phone: phone, p_visitor: visitor, p_utm: utm, p_link_code: linkCode,
      p_extra: { budget: budget || null, timeline: timeline || null }, p_trap: trap,
    });
    setBusy(false);
    if (error) return setErr("تعذّر الإرسال — حاول بعد قليل.");
    const r = data as { ok: boolean; message: string };
    if (!r.ok) return setErr(r.message);
    setDone(r.message);
  }

  if (done) {
    return <div className="mt-6 rounded-xl bg-brand-600 p-6 text-center text-white">{done}</div>;
  }
  const inp = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none";
  return (
    <form onSubmit={submit} className="mt-6 space-y-3 rounded-xl bg-white p-5 shadow">
      <label className="block text-sm text-gray-700">الاسم
        <input required value={name} onChange={(e) => setName(e.target.value)} className={inp} autoComplete="name" /></label>
      <label className="block text-sm text-gray-700">رقم الهاتف
        <input required value={phone} onChange={(e) => setPhone(e.target.value)} className={inp} dir="ltr" inputMode="tel" placeholder="07XXXXXXXXX" autoComplete="tel" /></label>
      {askBudget && (
        <label className="block text-sm text-gray-700">الميزانية التقريبية
          <input value={budget} onChange={(e) => setBudget(e.target.value)} className={inp} /></label>
      )}
      {askTimeline && (
        <label className="block text-sm text-gray-700">متى تنوي الشراء؟
          <select value={timeline} onChange={(e) => setTimeline(e.target.value)} className={inp}>
            <option value="">—</option><option>خلال شهر</option><option>خلال ٣ أشهر</option><option>خلال سنة</option><option>أستكشف فقط</option>
          </select></label>
      )}
      <input type="text" name="website" value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off"
        className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden="true" />
      {err && <p className="text-sm text-red-700">{err}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-brand-600 py-3 text-base font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
        {busy ? "يرسل…" : cta}
      </button>
    </form>
  );
}
