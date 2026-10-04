import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// ============================================================
// عميل للزائر غير المسجّل — للصفحتين العامّتين /r و /f وحدهما.
//
// بلا جلسة ولا كوكيز: الزائر لا يملك إلا ما مُنح لـ anon صراحةً، وهو
// أربع دوالّ في sql/124 (mkt_track_hit · mkt_track_view ·
// mkt_landing_public · mkt_submit_lead). لا جدول يُقرأ ولا يُكتب.
// ============================================================
export function createAnonClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
