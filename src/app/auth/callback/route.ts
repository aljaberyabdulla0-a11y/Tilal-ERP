import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// مسار المصادقة — يستبدل رمز الرابط (من بريد استعادة كلمة المرور) بجلسة
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // فشل — رابط غير صالح أو منتهٍ
  return NextResponse.redirect(`${origin}/login?error=recovery`);
}
