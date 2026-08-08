import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

// نوع مجموعة الكوكيز التي يمررها Supabase لدالة setAll
type CookiesToSet = { name: string; value: string; options: CookieOptions }[];

// ============================================================
// عميل Supabase للخادم — يُستخدم داخل Server Components وصفحات الخادم
// ويقرأ جلسة المستخدم من الكوكيز بشكل آمن.
//
// ملفوف بـ cache() من React: الصفحة الواحدة تستدعيه من عدة أماكن
// (التخطيط، الصفحة، المكوّنات)، وبدون التخزين يُنشأ عميل جديد كل مرة.
// نطاق الـ cache هو الطلب الواحد فقط، فلا تتسرّب جلسة مستخدم لآخر.
// ============================================================
export const createClient = cache(async () => {
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
});
