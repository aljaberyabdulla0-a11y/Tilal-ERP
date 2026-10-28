// ثوابت مركز الليدات (218) — بلا استيراد خادم، فتصلح للمتصفّح والخادم معاً.

export const PROVIDER_LABEL: Record<string, string> = {
  meta: "Meta (نماذج الإعلانات)",
  landing: "صفحة هبوط",
  website: "الموقع",
  whatsapp: "واتساب",
  manual: "تسجيل مركزي",
  sheet: "Lead Sheet",
  card: "بطاقة عميل",
  broker: "وسيط",
  legacy: "سابق للمركز",
};

export const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: "messenger", label: "رسالة فيسبوك (ماسنجر)" },
  { value: "instagram_dm", label: "رسالة إنستغرام" },
  { value: "whatsapp", label: "واتساب" },
  { value: "facebook", label: "تعليق / إعلان فيسبوك" },
  { value: "instagram", label: "تعليق / إعلان إنستغرام" },
  { value: "tiktok", label: "تيك توك" },
  { value: "phone", label: "اتصال هاتفي" },
  { value: "walk_in", label: "زيارة المكتب" },
  { value: "website", label: "الموقع" },
  { value: "referral", label: "توصية" },
  { value: "other", label: "أخرى" },
];

export const channelLabel = (v: string | null | undefined) =>
  CHANNEL_OPTIONS.find((c) => c.value === v)?.label ?? v ?? "—";

export const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n * 100) / d)}%` : "—");

export function minutesLabel(m: number | null | undefined): string {
  if (m === null || m === undefined) return "—";
  if (m < 60) return `${Math.round(m)} د`;
  if (m < 60 * 48) return `${(m / 60).toFixed(1)} س`;
  return `${(m / 1440).toFixed(1)} يوم`;
}
