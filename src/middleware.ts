import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// نوع مجموعة الكوكيز التي يمررها Supabase لدالة setAll
type CookiesToSet = { name: string; value: string; options: CookieOptions }[];

// الـ Middleware — حارس النظام:
// 1. يحدّث جلسة المستخدم مع كل طلب (حتى لا تنتهي فجأة)
// 2. يمنع غير المسجلين من دخول أي صفحة غير صفحة الدخول
// 3. يعيد المسجلين تلقائياً من صفحة الدخول إلى لوحة التحكم
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // جلب المستخدم الحالي (إن وجد)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname.startsWith("/login");

  // غير مسجل دخول + يحاول دخول صفحة محمية → إعادة توجيه لصفحة الدخول
  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // مسجل دخول + يحاول فتح صفحة الدخول → إعادة توجيه للوحة التحكم
  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

// تطبيق الحماية على كل المسارات ما عدا الملفات الثابتة والصور
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
