import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

// نوع مجموعة الكوكيز التي يمررها Supabase لدالة setAll
type CookiesToSet = { name: string; value: string; options: CookieOptions }[];

// عميل Supabase للخادم — يُستخدم داخل Server Components وصفحات الخادم
// يقرأ جلسة المستخدم من الكوكيز بشكل آمن
export async function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // يُتجاهل الخطأ إذا استُدعي من Server Component
            // لأن الـ middleware هو المسؤول عن تحديث الجلسة
          }
        },
      },
    }
  );
}
