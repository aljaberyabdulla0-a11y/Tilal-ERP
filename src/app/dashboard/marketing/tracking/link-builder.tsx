"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/components/marketing/record-form";
import { DESTINATION_KINDS, trackingUrl } from "@/lib/marketing-style";

// ============================================================
// منشئ روابط التتبّع — UTM يُستنتج من القناة والحملة (المحفّز يكمله
// في القاعدة كذلك، فلا رابطٌ بلا UTM حتى لو أُدخل من مكان آخر).
// المعاينة هنا للعين فقط؛ ما يُحفظ هو ما يقرّره mkt_stamp_link.
// ============================================================
type Opt = { id: string; name: string };
type Ch = { id: string; name: string; utm_source: string; utm_medium: string };
type Camp = { id: string; name: string; code: string };
type Page = { id: string; title: string; slug: string; campaign_id: string | null; hosted: boolean; external_url: string | null };

export function LinkBuilder({
  channels, campaigns, activities, deals, pages, contents, preset,
}: {
  channels: Ch[]; campaigns: Camp[]; activities: (Opt & { code: string })[]; deals: Opt[]; pages: Page[]; contents: (Opt & { code: string })[];
  preset: { campaign?: string; activity?: string; deal?: string };
}) {
  const router = useRouter();
  const [f, setF] = useState({
    name: "", destination_kind: "صفحة هبوط", destination_url: "", landing_page_id: "",
    channel_id: "", campaign_id: preset.campaign ?? "", activity_id: preset.activity ?? "", influencer_deal_id: preset.deal ?? "",
    content_id: "", utm_content: "", utm_term: "", is_qr: !!preset.activity, expires_on: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const ch = channels.find((c) => c.id === f.channel_id);
  const camp = campaigns.find((c) => c.id === f.campaign_id);
  const act = activities.find((a) => a.id === f.activity_id);
  const cnt = contents.find((c) => c.id === f.content_id);
  const page = pages.find((p) => p.id === f.landing_page_id);
  const dest = page ? (page.hosted ? `/f/${page.slug}` : page.external_url ?? "") : f.destination_url;
  const utmContent = f.utm_content || act?.code || cnt?.code || "";
  const preview = useMemo(() => {
    if (!ch || !dest) return "";
    const q = [`utm_source=${ch.utm_source}`, `utm_medium=${ch.utm_medium}`, `utm_campaign=${camp?.code ?? "general"}`,
      utmContent && `utm_content=${utmContent}`, f.utm_term && `utm_term=${f.utm_term}`].filter(Boolean).join("&");
    return `${dest}${dest.includes("?") ? "&" : "?"}${q}`;
  }, [ch, dest, camp, utmContent, f.utm_term]);

  async function save() {
    setErr(null);
    if (!f.name.trim()) return setErr("اسم الرابط.");
    if (!f.channel_id) return setErr("القناة — منها utm_source و utm_medium.");
    if (!dest) return setErr("الوجهة: صفحة هبوط أو رابط.");
    setBusy(true);
    const { error } = await createClient().from("mkt_tracking_links").insert({
      name: f.name.trim(), destination_kind: page ? "صفحة هبوط" : f.destination_kind, destination_url: dest,
      landing_page_id: page?.id ?? null, channel_id: f.channel_id, campaign_id: f.campaign_id || page?.campaign_id || null,
      activity_id: f.activity_id || null, influencer_deal_id: f.influencer_deal_id || null, content_id: f.content_id || null,
      utm_content: f.utm_content.trim().toLowerCase() || null, utm_term: f.utm_term.trim().toLowerCase() || null,
      is_qr: f.is_qr, expires_on: f.expires_on || null,
    });
    setBusy(false);
    if (error) return setErr(friendlyError(error.message, error.code) + (error.code === "23505" ? " — ميّز utm_content." : ""));
    set("name", "");
    router.refresh();
  }

  const inp = "mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5";
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="sm:col-span-2"><span className="text-xs text-gray-500">الاسم *</span><input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="QR لوحة طريق المطار" className={inp} /></label>
        <label><span className="text-xs text-gray-500">القناة *</span><select value={f.channel_id} onChange={(e) => set("channel_id", e.target.value)} className={inp}><option value="">اختر…</option>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">صفحة هبوط</span><select value={f.landing_page_id} onChange={(e) => set("landing_page_id", e.target.value)} className={inp}><option value="">— رابط آخر —</option>{pages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
        {!page && <>
          <label><span className="text-xs text-gray-500">نوع الوجهة</span><select value={f.destination_kind} onChange={(e) => set("destination_kind", e.target.value)} className={inp}>{DESTINATION_KINDS.filter((d) => d !== "صفحة هبوط").map((d) => <option key={d}>{d}</option>)}</select></label>
          <label><span className="text-xs text-gray-500">الوجهة</span><input value={f.destination_url} onChange={(e) => set("destination_url", e.target.value)} dir="ltr" placeholder="https://wa.me/9647… أو https://…" className={inp} /></label>
        </>}
        <label><span className="text-xs text-gray-500">الحملة</span><select value={f.campaign_id} onChange={(e) => set("campaign_id", e.target.value)} className={inp}><option value="">—</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">نشاط ميداني</span><select value={f.activity_id} onChange={(e) => set("activity_id", e.target.value)} className={inp}><option value="">—</option>{activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">مؤثر</span><select value={f.influencer_deal_id} onChange={(e) => set("influencer_deal_id", e.target.value)} className={inp}><option value="">—</option>{deals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">محتوى</span><select value={f.content_id} onChange={(e) => set("content_id", e.target.value)} className={inp}><option value="">—</option>{contents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span className="text-xs text-gray-500">utm_content</span><input value={f.utm_content} onChange={(e) => set("utm_content", e.target.value)} dir="ltr" placeholder={act?.code ?? cnt?.code ?? "video-30s"} className={inp} /></label>
        <label><span className="text-xs text-gray-500">utm_term</span><input value={f.utm_term} onChange={(e) => set("utm_term", e.target.value)} dir="ltr" className={inp} /></label>
        <label><span className="text-xs text-gray-500">ينتهي في</span><input type="date" value={f.expires_on} onChange={(e) => set("expires_on", e.target.value)} dir="ltr" className={inp} /></label>
        <label className="flex items-center gap-2 pt-5"><input type="checkbox" checked={f.is_qr} onChange={(e) => set("is_qr", e.target.checked)} /><span className="text-xs">للطباعة كـ QR (يُعدّ «مسحاً»)</span></label>
      </div>
      {preview && <p className="break-all rounded bg-gray-50 p-2 font-mono text-xs text-gray-600" dir="ltr">{preview}</p>}
      {err && <p className="text-xs text-red-700">{err}</p>}
      <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? "…" : "أنشئ الرابط"}</button>
    </div>
  );
}

export function QrButton({ origin, code, name, qr }: { origin: string; code: string; name: string; qr: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const url = trackingUrl(origin, code, qr);

  async function show() {
    setSrc(await QRCode.toDataURL(url, { width: 512, margin: 2, errorCorrectionLevel: "M" }));
  }
  async function svg() {
    const s = await QRCode.toString(url, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([s], { type: "image/svg+xml" }));
    a.download = `qr-${code}.svg`;
    a.click();
  }
  return (
    <span className="flex flex-col items-start gap-1 text-xs">
      <span className="flex gap-2">
        <button type="button" onClick={() => navigator.clipboard.writeText(url)} className="text-brand-600 hover:underline">انسخ</button>
        <button type="button" onClick={show} className="text-brand-600 hover:underline">QR</button>
        <button type="button" onClick={svg} className="text-brand-600 hover:underline">SVG للطباعة</button>
      </span>
      {src && (
        <span className="rounded border bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`QR ${name}`} width={160} height={160} />
          <a href={src} download={`qr-${code}.png`} className="mt-1 block text-center text-brand-600">PNG</a>
        </span>
      )}
    </span>
  );
}
