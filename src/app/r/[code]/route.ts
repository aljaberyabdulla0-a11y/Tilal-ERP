import { NextResponse, type NextRequest } from "next/server";
import { createAnonClient } from "@/lib/supabase/anon";

export const dynamic = "force-dynamic";

// ============================================================
// /r/<رمز> — كل رابط تتبّع و QR يمرّ من هنا.
//
//   ١) معرّف زائر في كوكي (سنة) — به تُربط نقراته بليده حين يسجّل في /f
//   ٢) mkt_track_hit يسجّل النقرة أو المسح ويُرجع الوجهة بمعاملات UTM
//   ٣) تحويل 302
//
// لا اسم ولا هاتف ولا عنوان IP يُحفظ: الجهاز (جوال/حاسوب) ومضيف الإحالة.
// ============================================================
function device(ua: string): string {
  if (/ipad|tablet/i.test(ua)) return "لوحي";
  if (/mobi|android|iphone/i.test(ua)) return "جوال";
  return ua ? "حاسوب" : "غير معروف";
}

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const existing = req.cookies.get("mkt_vid")?.value;
  const visitor = existing && /^[a-zA-Z0-9-]{8,64}$/.test(existing) ? existing : crypto.randomUUID();
  let refHost: string | null = null;
  try { refHost = req.headers.get("referer") ? new URL(req.headers.get("referer")!).host : null; } catch { /* إحالة تالفة */ }

  const { data, error } = await createAnonClient().rpc("mkt_track_hit", {
    p_code: params.code,
    p_qr: req.nextUrl.searchParams.get("q") === "1",
    p_visitor: visitor,
    p_device: device(req.headers.get("user-agent") ?? ""),
    p_referrer: refHost,
  });

  const target = !error && typeof data === "string" && data
    ? (data.startsWith("/") ? new URL(data, req.nextUrl.origin).toString() : data)
    // رمزٌ موقوف أو منتهٍ: صفحة «غير متاح» (لا /r/… — كان سيدور على نفسه)
    : new URL("/f/unavailable", req.nextUrl.origin).toString();
  if (error) console.error("[marketing] mkt_track_hit:", error.message);

  const res = NextResponse.redirect(target, 302);
  res.cookies.set("mkt_vid", visitor, { maxAge: 60 * 60 * 24 * 365, sameSite: "lax", path: "/", httpOnly: false });
  return res;
}
