import { createBrowserClient } from "@supabase/ssr";

// عميل Supabase للمتصفح — يُستخدم داخل مكونات الواجهة (Client Components)
// المفتاح هنا "publishable" أي مسموح ظهوره بالمتصفح، والحماية الحقيقية
// تكون عبر Row Level Security داخل قاعدة البيانات
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
