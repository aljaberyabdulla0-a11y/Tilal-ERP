import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { canWriteMarketing } from "@/lib/auth";
import { getCampaignsLite, getChannels, getMktProjects, getPeople } from "@/lib/marketing";
import { fmt, fmtPct } from "@/lib/marketing-style";
import { Badge, Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm, { type FieldSpec } from "@/components/marketing/record-form";
import { FieldSelect, ToggleField } from "@/components/marketing/actions";
import { LinkBuilder, QrButton } from "./link-builder";

// ============================================================
// التتبّع — روابط و QR و UTM موحّد، وصفحات الهبوط.
//
// كل رابط يمرّ بـ /r/<رمز>: يُسجَّل النقر أو المسح بمعرّف زائر، ثم
// يُحوَّل إلى وجهته بمعاملاتها. وحين يملأ الزائر نموذج /f/<صفحة>
// تصير نقراته السابقة لمساتٍ على ليده (124) — فيُعرف أيّ لوحة وأيّ
// إعلان جاء به، لا ما تذكّره هو.
// ============================================================
export default async function TrackingPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const sp = searchParams;
  const tab = sp.tab === "pages" ? "pages" : "links";
  const h = headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const supabase = await createClient();
  const [write, channels, campaigns, projects, people, { data: pages }] = await Promise.all([
    canWriteMarketing(), getChannels(), getCampaignsLite(), getMktProjects(), getPeople(),
    supabase.from("mkt_landing_pages").select("*").order("created_at", { ascending: false }),
  ]);

  const tabs = (
    <nav className="flex gap-1 border-b border-gray-200">
      {[["links", "الروابط و QR"], ["pages", "صفحات الهبوط"]].map(([k, l]) => (
        <Link key={k} href={`/dashboard/marketing/tracking?tab=${k}`}
          className={tab === k ? "-mb-px border-b-2 border-brand-600 px-3 py-2 text-sm font-semibold text-brand-600" : "px-3 py-2 text-sm text-gray-500"}>{l}</Link>
      ))}
    </nav>
  );

  if (tab === "pages") {
    const ids = (pages ?? []).map((p) => p.id);
    const [{ data: views }, { data: touches }] = await Promise.all([
      ids.length ? supabase.from("mkt_link_hits").select("landing_page_id").eq("kind", "زيارة").in("landing_page_id", ids).limit(100000) : Promise.resolve({ data: [] as { landing_page_id: string }[] }),
      ids.length ? supabase.from("mkt_touchpoints").select("landing_page_id, client_id").eq("touch_type", "نموذج").in("landing_page_id", ids).limit(100000) : Promise.resolve({ data: [] as { landing_page_id: string; client_id: string }[] }),
    ]);
    const v = new Map<string, number>(); for (const x of views ?? []) v.set(x.landing_page_id, (v.get(x.landing_page_id) ?? 0) + 1);
    const l = new Map<string, number>(); for (const x of touches ?? []) l.set(x.landing_page_id!, (l.get(x.landing_page_id!) ?? 0) + 1);
    // Creating and editing share one list — the slug included, it's not modified after publishing
    const landingFields: FieldSpec[] = [
      { name: "title", label: "العنوان الداخلي", required: true, span: 2 },
      { name: "slug", label: "الرابط (لاتيني)", required: true, ltr: true, placeholder: "lamac-oct", hint: "يصير /f/lamac-oct — لا تغيّره بعد طباعة رابطه" },
      { name: "project_id", label: "المشروع", type: "select", options: projects.map((p) => ({ value: p.id, label: p.name })) },
      { name: "campaign_id", label: "الحملة", type: "select", options: campaigns.map((c) => ({ value: c.id, label: c.name })) },
      { name: "status", label: "الحالة", type: "select", options: ["مسودة", "منشورة", "متوقفة"], required: true },
      { name: "headline", label: "العنوان الظاهر", span: 3, placeholder: "شقق جاهزة بالتقسيط في …" },
      { name: "body", label: "النصّ", type: "textarea", span: 3 },
      { name: "hero_image_url", label: "صورة الغلاف (رابط https)", ltr: true, span: 2,
        hint: "رابط صورة عامّة (موقع الشركة، صفحة فيسبوك…) — مكتبة الأصول خاصّة لا تُعرض للزائر" },
      { name: "whatsapp_phone", label: "رقم واتساب", ltr: true, placeholder: "07XXXXXXXXX", hint: "يظهر زرّ «راسلنا على واتساب»" },
      { name: "cta", label: "زرّ الإرسال" },
      { name: "conversion_goal", label: "هدف التحويل" },
      { name: "owner_employee_id", label: "المسؤول", type: "select", options: people.map((p) => ({ value: p.id, label: p.full_name })) },
      { name: "show_project_facts", label: "اعرض حقائق المشروع", type: "checkbox", placeholder: "المتاح، المساحات، أقلّ سعر" },
      { name: "ask_budget", label: "اسأل عن الميزانية", type: "checkbox" },
      { name: "ask_timeline", label: "اسأل عن موعد الشراء", type: "checkbox" },
      { name: "hosted", label: "مستضافة عندنا", type: "checkbox", placeholder: "غير ذلك: موقع خارجي يرسل إلى البوّابة" },
      { name: "external_url", label: "الرابط الخارجي (إن لم تُستضف)", ltr: true, span: 2 },
      { name: "thank_you", label: "رسالة الشكر", span: 3 },
    ];
    return (
      <>
        <PageHead title="صفحات الهبوط" sub="صفحة مستضافة على /f/<الرابط> بنموذج يدخل بوّابة الليدات مباشرةً — بحقائق المشروع من الوحدات المتاحة، لا بما يُكتب." />
        {tabs}
        {write && <RecordForm table="mkt_landing_pages" openLabel="صفحة جديدة" initial={{ hosted: true, status: "مسودة", cta: "سجّل اهتمامك", show_project_facts: true }}
          fields={landingFields} />}
        <Card>
          <SimpleTable empty="لا صفحات."
            head={["الصفحة", "الرابط", "الحملة", "الحالة", "زيارات", "ليدات", "التحويل"]}
            rows={(pages ?? []).map((p) => [
              <span key="t">
                {p.title}
                {write && <span className="mt-1 block"><RecordForm table="mkt_landing_pages" id={p.id} openLabel="عدّل الصفحة" openIcon="edit"
                  submitLabel="احفظ" initial={p as Record<string, unknown>} fields={landingFields} /></span>}
              </span>,
              p.hosted ? <a key="u" href={`/f/${p.slug}`} target="_blank" className="font-mono text-xs text-brand-600" dir="ltr">/f/{p.slug}</a> : <span key="u" dir="ltr" className="text-xs">{p.external_url}</span>,
              campaigns.find((c) => c.id === p.campaign_id)?.name ?? "—",
              write ? <FieldSelect key="s" table="mkt_landing_pages" id={p.id} column="status" value={p.status} options={["مسودة", "منشورة", "متوقفة"]} /> : <Badge key="s">{p.status}</Badge>,
              fmt(v.get(p.id) ?? 0), fmt(l.get(p.id) ?? 0),
              fmtPct((v.get(p.id) ?? 0) > 0 ? ((l.get(p.id) ?? 0) * 100) / (v.get(p.id) ?? 1) : null),
            ])} />
        </Card>
      </>
    );
  }

  let lq = supabase.from("mkt_tracking_links").select("*").order("created_at", { ascending: false }).limit(300);
  if (sp.campaign) lq = lq.eq("campaign_id", sp.campaign);
  const [{ data: links }, { data: activities }, { data: deals }, { data: contents }] = await Promise.all([
    lq,
    supabase.from("mkt_activities").select("id, title, code").order("created_at", { ascending: false }).limit(200),
    supabase.from("mkt_influencer_deals").select("id, mkt_influencers(name)").neq("stage", "ملغى"),
    supabase.from("mkt_content").select("id, title, code").neq("status", "مؤرشف").order("created_at", { ascending: false }).limit(200),
  ]);
  const ids = (links ?? []).map((x) => x.id);
  const { data: hits } = ids.length
    ? await supabase.from("mkt_link_hits").select("link_id, kind").in("link_id", ids).limit(100000)
    : { data: [] as { link_id: string; kind: string }[] };
  const { data: tps } = ids.length
    ? await supabase.from("mkt_touchpoints").select("link_id, client_id").in("link_id", ids).limit(100000)
    : { data: [] as { link_id: string; client_id: string }[] };
  const clicks = new Map<string, number>(); const scans = new Map<string, number>(); const leads = new Map<string, Set<string>>();
  for (const x of hits ?? []) (x.kind === "مسح" ? scans : clicks).set(x.link_id, ((x.kind === "مسح" ? scans : clicks).get(x.link_id) ?? 0) + 1);
  for (const x of tps ?? []) leads.set(x.link_id!, (leads.get(x.link_id!) ?? new Set()).add(x.client_id));
  const chName = new Map(channels.map((c) => [c.id, c.name]));
  const campName = new Map(campaigns.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHead title="الروابط و QR" sub="UTM يُولَّد من القناة والحملة — لا يُكتب باليد فلا يتشتّت «facebook» و«Facebook» و«fb». ورمز QR المطبوع لا يتغيّر، والرابط يُوقف بتاريخ انتهاء." />
      {tabs}
      {write && (
        <Card title="رابط أو QR جديد">
          <LinkBuilder
            channels={channels.map((c) => ({ id: c.id, name: c.name, utm_source: c.utm_source, utm_medium: c.utm_medium }))}
            campaigns={campaigns.map((c) => ({ id: c.id, name: c.name, code: c.code }))}
            activities={(activities ?? []).map((a) => ({ id: a.id, name: a.title, code: a.code }))}
            deals={(deals ?? []).map((d) => ({ id: d.id, name: (d.mkt_influencers as unknown as { name: string } | null)?.name ?? "مؤثر" }))}
            pages={(pages ?? []).filter((p) => p.status !== "متوقفة")}
            contents={(contents ?? []).map((c) => ({ id: c.id, name: c.title, code: c.code }))}
            preset={{ campaign: sp.campaign, activity: sp.activity, deal: sp.deal }} />
        </Card>
      )}
      <Card>
        <SimpleTable empty="لا روابط."
          head={["الرابط", "القناة / الحملة", "UTM", "نقرات", "مسوح", "ليدات", "الحالة", ""]}
          rows={(links ?? []).map((x) => [
            <span key="n">{x.name}<span className="block font-mono text-xs text-gray-400" dir="ltr">/r/{x.code}{x.expires_on ? ` · حتى ${x.expires_on}` : ""}</span></span>,
            <span key="c" className="text-xs">{chName.get(x.channel_id) ?? "—"}<span className="block text-brand-700">{campName.get(x.campaign_id ?? "") ?? "—"}</span></span>,
            <span key="u" dir="ltr" className="text-xs text-gray-600">{x.utm_source} / {x.utm_medium} / {x.utm_campaign}{x.utm_content ? ` / ${x.utm_content}` : ""}</span>,
            fmt(clicks.get(x.id) ?? 0), fmt(scans.get(x.id) ?? 0), <b key="l" className="text-brand-700">{fmt(leads.get(x.id)?.size ?? 0)}</b>,
            write ? <ToggleField key="a" table="mkt_tracking_links" id={x.id} column="is_active" value={x.is_active} /> : (x.is_active ? "فعّال" : "موقوف"),
            <QrButton key="q" origin={origin} code={x.code} name={x.name} qr={x.is_qr} />,
          ])} />
        <p className="mt-2 text-xs text-gray-500">«ليدات» = عملاءٌ لهم لمسة على الرابط — نقرةٌ أو مسحٌ سبق تسجيلهم، أو تسجيلٌ عبره مباشرةً.</p>
      </Card>
    </>
  );
}
