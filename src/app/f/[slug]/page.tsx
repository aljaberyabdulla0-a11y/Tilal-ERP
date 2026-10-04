import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createAnonClient } from "@/lib/supabase/anon";
import Logo from "@/components/logo";
import LeadForm from "./lead-form";

export const dynamic = "force-dynamic";

// ============================================================
// /f/<الصفحة> — صفحة الهبوط المستضافة.
//
// الحقائق من الوحدات المتاحة فعلاً (mkt_landing_public): عددٌ ومدى
// مساحات وأقلّ سعر — لا وحدةٌ بعينها ولا رقمٌ يُكتب في نصٍّ فيتقادم.
// والنموذج يدخل بوّابة الليدات (crm_lead_intake) ثم intake_lead كما
// يدخلها ليد ميتا — بلا مسارٍ ثانٍ إلى جدول العملاء.
// ============================================================
type Landing = {
  slug: string; title: string; headline: string | null; body: string | null; cta: string; thank_you: string;
  ask_budget: boolean; ask_timeline: boolean;
  project: { name: string; governorate: string | null; area: string | null; available: number; types: string[] | null;
    min_space: number | null; max_space: number | null; min_price: number | null } | null;
};

async function load(slug: string): Promise<Landing | null> {
  const { data, error } = await createAnonClient().rpc("mkt_landing_public", { p_slug: slug });
  if (error) console.error("[marketing] mkt_landing_public:", error.message);
  return (data as Landing | null) ?? null;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const p = await load(params.slug);
  return { title: p ? (p.headline ?? p.title) : "تلال", robots: { index: false } };
}

export default async function LandingPage({ params, searchParams }: { params: { slug: string }; searchParams: Record<string, string> }) {
  const page = await load(params.slug);
  if (!page) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6 text-center" dir="rtl">
        <div><Logo /><p className="mt-4 text-gray-600">هذه الصفحة غير متاحة الآن.</p></div>
      </main>
    );
  }
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    if (searchParams[k]) utm[k] = String(searchParams[k]).slice(0, 80);
  }
  const visitor = cookies().get("mkt_vid")?.value ?? null;
  const p = page.project;
  const n = (x: number | null) => (x == null ? null : Number(x).toLocaleString("en-US"));

  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-50 to-white" dir="rtl">
      <div className="mx-auto max-w-xl px-4 py-8">
        <Logo />
        <h1 className="mt-6 text-2xl font-bold leading-snug text-brand-700">{page.headline ?? page.title}</h1>
        {page.body && <p className="mt-3 whitespace-pre-line text-gray-700">{page.body}</p>}

        {p && (
          <section className="mt-5 grid grid-cols-2 gap-2 text-center text-sm">
            <div className="rounded-lg bg-white p-3 shadow-sm"><p className="font-bold text-brand-700">{p.name}</p><p className="text-xs text-gray-500">{[p.governorate, p.area].filter(Boolean).join(" — ")}</p></div>
            <div className="rounded-lg bg-white p-3 shadow-sm"><p className="font-bold text-brand-700">{n(p.available)}</p><p className="text-xs text-gray-500">وحدة متاحة الآن</p></div>
            {p.min_space && <div className="rounded-lg bg-white p-3 shadow-sm"><p className="font-bold text-brand-700" dir="ltr">{n(p.min_space)}–{n(p.max_space)} م²</p><p className="text-xs text-gray-500">المساحات</p></div>}
            {p.min_price && <div className="rounded-lg bg-white p-3 shadow-sm"><p className="font-bold text-brand-700">{n(p.min_price)}</p><p className="text-xs text-gray-500">يبدأ السعر من</p></div>}
            {p.types && p.types.length > 0 && <div className="col-span-2 rounded-lg bg-white p-3 text-xs text-gray-600 shadow-sm">{p.types.join(" · ")}</div>}
          </section>
        )}

        <LeadForm slug={page.slug} cta={page.cta} thankYou={page.thank_you} askBudget={page.ask_budget} askTimeline={page.ask_timeline}
          visitor={visitor} utm={utm} linkCode={searchParams.mkt_l ?? null} />
        <p className="mt-6 text-center text-xs text-gray-400">بإرسالك النموذج توافق على أن يتصل بك فريق تلال بخصوص هذا المشروع فقط.</p>
      </div>
    </main>
  );
}
