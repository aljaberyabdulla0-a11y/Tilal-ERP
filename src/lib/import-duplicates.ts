import { createClient } from "@/lib/supabase/server";
import { phoneKey, type ParsedRow } from "@/lib/clients-excel";

// ============================================================
// كشف التكرار قبل الحفظ — بالمفتاح المطبّع لا بالنصّ (§48 · sql/071).
//
// «07701234567» و«+9647701234567» شخصٌ واحد. المقارنة بالنصّ كانت
// تُدخل الثاني عميلاً جديداً ثم يرصده فحص التكرار لاحقاً — والأصل
// ألّا يدخل. تُستدعى من المعاينة (لتُعرض) ومن الالتزام (لتُرفض):
// فحصٌ في المعاينة وحدها يُلتفّ عليه بإعادة إرسال الصفوف.
//
// قبل الهجرة 071 لا عمود phone_key؛ فنسقط إلى مطابقة النصّ القديمة.
// ============================================================
export async function markDuplicates(rows: ParsedRow[]): Promise<void> {
  const keyed = rows
    .map((r) => ({ r, key: phoneKey(r.values.phone), phone: r.values.phone }))
    .filter((x) => x.phone);
  if (keyed.length === 0) return;

  const supabase = await createClient();
  const existingKeys = new Set<string>();
  const existingPhones = new Set<string>();

  const keys = Array.from(new Set(keyed.map((x) => x.key).filter((k): k is string => Boolean(k))));
  let usedKeys = false;
  if (keys.length > 0) {
    const { data, error } = await supabase.from("clients").select("phone_key").in("phone_key", keys);
    if (!error) {
      usedKeys = true;
      for (const c of (data ?? []) as { phone_key: string | null }[]) if (c.phone_key) existingKeys.add(c.phone_key);
    }
  }
  if (!usedKeys) {
    const phones = Array.from(new Set(keyed.map((x) => x.phone as string)));
    const { data } = await supabase.from("clients").select("phone").in("phone", phones);
    for (const c of (data ?? []) as { phone: string | null }[]) if (c.phone) existingPhones.add(c.phone);
  }

  const seen = new Set<string>();
  for (const { r, key, phone } of keyed) {
    const id = key ?? (phone as string);
    const inSystem = key ? existingKeys.has(key) : existingPhones.has(phone as string);
    if (inSystem) {
      r.duplicate = true;
      r.errors.push(`رقم الهاتف ${phone} موجود مسبقاً في النظام.`);
    } else if (seen.has(id)) {
      r.duplicate = true;
      r.errors.push(`رقم الهاتف ${phone} مكرّر داخل الملف نفسه.`);
    }
    seen.add(id);
  }
}
