import { compareValues, type Delta } from "@/lib/report-engine";
import type { Unit } from "./format";

// ============================================================
// نموذج مؤشّر الأداء (KPI) — ما تعرضه بطاقةٌ واحدة.
//
// الاتجاه **معنى المؤشّر** لا إشارة الرقم:
//   positive  الارتفاع جيد (المبيعات، الحجوزات)
//   negative  الارتفاع سيئ (المتأخرات، دورة البيع، الخسائر، المصاريف)
//   neutral   لا حكم (عدد الوحدات المتاحة، الإنفاق التسويقي)
//
// فارتفاع المصاريف ١٢٪ يُلوَّن «سيئاً» وإن كان سهمه للأعلى. والحكم
// يُحسب في compareValues (محرّك التقارير) — نفس منطق التقارير حرفاً.
// ============================================================

export type Direction = "positive" | "negative" | "neutral";

export type Kpi = {
  key: string;
  title: string;
  value: number | null;
  unit: Unit;
  delta: Delta | null;     // null = لا مقارنة لهذا المؤشّر (لقطة لا فترة)
  direction: Direction;
  icon: string;
  href?: string;
  subtitle?: string;       // سياق الرقم: «من 706 وحدة»
  definition?: string;     // التعريف — يظهر تلميحاً ولقارئ الشاشة
  source?: string;         // من أين الرقم — يتتبّعه المدقّق
  status?: "good" | "warning" | "danger" | "neutral";
};

export function goodOf(direction: Direction): "up" | "down" | null {
  return direction === "positive" ? "up" : direction === "negative" ? "down" : null;
}

export function makeKpi(
  base: Omit<Kpi, "delta">,
  previous: number | null | undefined
): Kpi {
  const delta = previous === undefined ? null : compareValues(base.value, previous, goodOf(base.direction));
  return { ...base, delta };
}

// قيمة رقمية آمنة من كائن القاعدة — ما ليس رقماً يصير null لا صفراً
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// حالة عدّاد تنبيهي: صفر جيد، وما فوق العتبة خطر
export function countStatus(n: number | null, dangerAt = 1, warnAt = 1): Kpi["status"] {
  if (n === null) return "neutral";
  if (n >= dangerAt && dangerAt > 0) return "danger";
  if (n >= warnAt && warnAt > 0) return "warning";
  return "good";
}

// نسبة التصريف: المباع من الإجمالي — لمقارنة المشاريع بصرياً
export function sellThrough(sold: number, total: number): number | null {
  return total > 0 ? Math.round((sold / total) * 1000) / 10 : null;
}

// ترتيب المشاريع: الأعلى تصريفاً «الأفضل»، والأدنى مع مخزونٍ متاح «يحتاج انتباهاً»
export function rankProjects<T extends { id: string; sellThrough: number | null; revenue: number | null; available: number }>(
  rows: T[]
): { top: Set<string>; attention: Set<string> } {
  const scored = rows.filter((r) => r.sellThrough !== null);
  if (scored.length < 2) return { top: new Set(), attention: new Set() };
  const byScore = [...scored].sort(
    (a, b) => (b.sellThrough ?? 0) - (a.sellThrough ?? 0) || (b.revenue ?? 0) - (a.revenue ?? 0)
  );
  const top = new Set([byScore[0].id]);
  const last = byScore[byScore.length - 1];
  const attention = new Set(last.id !== byScore[0].id && last.available > 0 ? [last.id] : []);
  return { top, attention };
}
