import { getI18n } from "@/lib/i18n/server";
import { getWeekStartDow } from "@/lib/crm-reporting";
import { baghdadDate } from "@/lib/time";
import { fill, fmtShortDate } from "@/lib/dashboard/format";
import { parseDashFilters, type DashFilters, type DashPreset, type RawParams } from "@/lib/dashboard/period";

// ============================================================
// ما تتشاركه اللوحات: قراءة المُرشِّحات من الرابط بتوقيت بغداد،
// ووصف الفترة وفترة المقارنة نصّاً باللغة الحالية.
// ============================================================

export async function readFilters(sp: RawParams, defaultPreset: DashPreset = "this_month"): Promise<DashFilters> {
  const weekStartDow = await getWeekStartDow();
  return parseDashFilters(sp, { today: baghdadDate(), weekStartDow, defaultPreset });
}

export function rangeText(f: DashFilters): string {
  const { locale, t } = getI18n();
  if (f.preset !== "custom") return t.dash.filters.presets[f.preset];
  return f.range.from === f.range.to
    ? fmtShortDate(f.range.from, locale)
    : `${fmtShortDate(f.range.from, locale)} – ${fmtShortDate(f.range.to, locale)}`;
}

export function compareText(f: DashFilters): string | null {
  const { locale, t } = getI18n();
  if (!f.previous) return null;
  return fill(t.dash.filters.comparedTo, {
    from: fmtShortDate(f.previous.from, locale),
    to: fmtShortDate(f.previous.to, locale),
  });
}

export function DashMain({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">{children}</main>;
}
