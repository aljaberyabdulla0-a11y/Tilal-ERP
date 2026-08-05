// ============================================================
// تجميع أرقام تقارير الـ CRM.
// دوال خالصة (تستقبل البيانات وترجع الأرقام) — تُختبر بسهولة
// وتبقى الصفحة مسؤولة عن العرض فقط.
// ============================================================

import type { Client, ClientActivity } from "@/lib/types";
import { baghdadDate } from "@/lib/time";

// المراحل التي ما زالت تحتاج متابعة
export const OPEN_STAGES = ["ليد", "اتصال", "زيارة", "مناقشة العرض"] as const;
export const WON_STAGE = "بيع";
export const LOST_STAGE = "فشل البيع";

// مراحل القمع بالترتيب (بلا «فشل البيع» — هو تسرّب وليس خطوة)
export const FUNNEL_STAGES = [...OPEN_STAGES, WON_STAGE];

export function isOpen(c: Client): boolean {
  const s = c.stage ?? "ليد";
  return s !== WON_STAGE && s !== LOST_STAGE;
}

// فرق الأيام بين تاريخين بصيغة YYYY-MM-DD
export function daysDiff(from: string, to: string): number {
  return Math.round(
    (new Date(to + "T12:00:00Z").getTime() - new Date(from + "T12:00:00Z").getTime()) /
      86400000
  );
}

// ===== ١) قمع المبيعات =====

export type FunnelStep = {
  stage: string;
  count: number;
  // نسبة من دخلوا هذه المرحلة أو تجاوزوها، من إجمالي من دخل القمع
  reachedPercent: number;
  // نسبة الانتقال من المرحلة السابقة
  stepConversion: number | null;
};

export function buildFunnel(clients: Client[]): {
  steps: FunnelStep[];
  entered: number;
  lost: number;
} {
  const stageIndex = (c: Client) => FUNNEL_STAGES.indexOf(c.stage ?? "ليد");
  const lost = clients.filter((c) => (c.stage ?? "ليد") === LOST_STAGE).length;
  const inFunnel = clients.filter((c) => stageIndex(c) >= 0);
  const entered = inFunnel.length + lost;

  const steps: FunnelStep[] = FUNNEL_STAGES.map((stage, i) => {
    // «وصل» = العملاء في هذه المرحلة أو ما بعدها
    const reached = inFunnel.filter((c) => stageIndex(c) >= i).length;
    return {
      stage,
      count: reached,
      reachedPercent: entered > 0 ? Math.round((reached / entered) * 100) : 0,
      stepConversion: null,
    };
  });

  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1].count;
    steps[i].stepConversion = prev > 0 ? Math.round((steps[i].count / prev) * 100) : null;
  }

  return { steps, entered, lost };
}

// ===== ٢) لوحة عمل اليوم =====

export type FollowUpRow = {
  client: Client;
  daysLate: number;      // 0 = اليوم، موجب = متأخر
  stalled: boolean;      // فات الموعد ولا تواصل ولا تحديث بعده
};

export function buildFollowUps(
  clients: Client[],
  today = baghdadDate()
): { overdue: FollowUpRow[]; dueToday: FollowUpRow[] } {
  const overdue: FollowUpRow[] = [];
  const dueToday: FollowUpRow[] = [];

  for (const c of clients) {
    if (!c.follow_up_date || !isOpen(c)) continue;
    const daysLate = daysDiff(c.follow_up_date, today);
    if (daysLate < 0) continue; // موعده لم يحن بعد

    // «متوقّف» = فات الموعد ولم يحصل تواصل بعده
    const lastContactDay = c.last_contact_at ? baghdadDate(c.last_contact_at) : null;
    const stalled =
      daysLate >= 1 && (!lastContactDay || lastContactDay < c.follow_up_date);

    const row: FollowUpRow = { client: c, daysLate, stalled };
    if (daysLate === 0) dueToday.push(row);
    else overdue.push(row);
  }

  overdue.sort((a, b) => b.daysLate - a.daysLate);
  dueToday.sort((a, b) => a.client.name.localeCompare(b.client.name, "ar"));
  return { overdue, dueToday };
}

// عملاء مفتوحون بلا أي تواصل منذ مدة
export function buildNeglected(
  clients: Client[],
  minDays = 14,
  today = baghdadDate()
): { client: Client; days: number | null }[] {
  return clients
    .filter(isOpen)
    .map((c) => ({
      client: c,
      days: c.last_contact_at ? daysDiff(baghdadDate(c.last_contact_at), today) : null,
    }))
    .filter((r) => r.days === null || r.days >= minDays)
    .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999));
}

// ===== ٣) أداء الفريق =====

export type TeamRow = {
  name: string;
  clients: number;
  open: number;
  won: number;
  lost: number;
  winRate: number;        // من الصفقات المغلقة
  activities: number;     // عدد التواصل في الفترة
  calls: number;
  meetings: number;
  overdue: number;        // متابعات متأخرة عليه الآن
  noContact: number;      // عملاء لم يتواصل معهم إطلاقاً
};

export function buildTeam(
  clients: Client[],
  activities: ClientActivity[],
  today = baghdadDate()
): TeamRow[] {
  const byName = new Map<string, TeamRow>();
  const clientOwner = new Map<string, string>();

  const row = (name: string): TeamRow => {
    let r = byName.get(name);
    if (!r) {
      r = {
        name, clients: 0, open: 0, won: 0, lost: 0, winRate: 0,
        activities: 0, calls: 0, meetings: 0, overdue: 0, noContact: 0,
      };
      byName.set(name, r);
    }
    return r;
  };

  for (const c of clients) {
    const name = c.sales_employee?.trim() || "غير مسند";
    clientOwner.set(c.id, name);
    const r = row(name);
    r.clients++;

    const stage = c.stage ?? "ليد";
    if (stage === WON_STAGE) r.won++;
    else if (stage === LOST_STAGE) r.lost++;
    else r.open++;

    if (isOpen(c)) {
      if (!c.last_contact_at) r.noContact++;
      if (c.follow_up_date && daysDiff(c.follow_up_date, today) >= 1) r.overdue++;
    }
  }

  for (const a of activities) {
    if (a.activity_type === "تغيير مرحلة") continue;
    const name = clientOwner.get(a.client_id);
    if (!name) continue;         // نشاط على عميل خارج النطاق المعروض
    const r = row(name);
    r.activities++;
    if (a.activity_type === "مكالمة") r.calls++;
    if (a.activity_type === "اجتماع" || a.activity_type === "زيارة") r.meetings++;
  }

  const rows = Array.from(byName.values());
  for (const r of rows) {
    const closed = r.won + r.lost;
    r.winRate = closed > 0 ? Math.round((r.won / closed) * 100) : 0;
  }

  return rows.sort((a, b) => b.clients - a.clients);
}

// ===== ٤) مصادر العملاء — أيّها يجيب صفقات فعلاً =====

export type SourceRow = {
  source: string;
  total: number;
  won: number;
  lost: number;
  winRate: number;
};

export function buildSources(clients: Client[]): SourceRow[] {
  const map = new Map<string, SourceRow>();

  for (const c of clients) {
    const source = c.source?.trim() || "غير محدّد";
    let r = map.get(source);
    if (!r) {
      r = { source, total: 0, won: 0, lost: 0, winRate: 0 };
      map.set(source, r);
    }
    r.total++;
    const stage = c.stage ?? "ليد";
    if (stage === WON_STAGE) r.won++;
    else if (stage === LOST_STAGE) r.lost++;
  }

  const rows = Array.from(map.values());
  for (const r of rows) {
    const closed = r.won + r.lost;
    r.winRate = closed > 0 ? Math.round((r.won / closed) * 100) : 0;
  }

  return rows.sort((a, b) => b.total - a.total);
}

// ===== ٥) نشاط التواصل يوماً بيوم =====

export type TrendPoint = { date: string; label: string; count: number };

export function buildTrend(
  activities: ClientActivity[],
  days = 14,
  today = baghdadDate()
): TrendPoint[] {
  const counts = new Map<string, number>();
  for (const a of activities) {
    if (a.activity_type === "تغيير مرحلة") continue;
    const d = baghdadDate(a.occurred_at);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }

  const out: TrendPoint[] = [];
  const base = new Date(today + "T12:00:00Z").getTime();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base - i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    out.push({
      date: iso,
      label: iso.slice(5).replace("-", "/"), // MM/DD
      count: counts.get(iso) ?? 0,
    });
  }
  return out;
}

// ===== ٦) متوسط زمن إغلاق الصفقة =====
// من إضافة العميل حتى انتقاله لمرحلة «بيع»
export function averageDaysToWin(
  clients: Client[],
  activities: ClientActivity[]
): number | null {
  const created = new Map(clients.map((c) => [c.id, c.created_at]));
  const spans: number[] = [];

  for (const a of activities) {
    if (a.stage_to !== WON_STAGE) continue;
    const start = created.get(a.client_id);
    if (!start) continue;
    const d = Math.round(
      (new Date(a.occurred_at).getTime() - new Date(start).getTime()) / 86400000
    );
    if (d >= 0) spans.push(d);
  }

  if (spans.length === 0) return null;
  return Math.round(spans.reduce((s, n) => s + n, 0) / spans.length);
}

// ===== ٧) المؤشرات العليا =====

export type CrmKpis = {
  total: number;
  open: number;
  won: number;
  lost: number;
  winRate: number;
  newThisMonth: number;
  overdueFollowUps: number;
  dueTodayFollowUps: number;
  neglected: number;
  activitiesThisPeriod: number;
  avgDaysToWin: number | null;
};

export function buildKpis(
  clients: Client[],
  activities: ClientActivity[],
  today = baghdadDate()
): CrmKpis {
  const month = today.slice(0, 7);
  const { overdue, dueToday } = buildFollowUps(clients, today);

  const won = clients.filter((c) => (c.stage ?? "ليد") === WON_STAGE).length;
  const lost = clients.filter((c) => (c.stage ?? "ليد") === LOST_STAGE).length;
  const closed = won + lost;

  return {
    total: clients.length,
    open: clients.filter(isOpen).length,
    won,
    lost,
    winRate: closed > 0 ? Math.round((won / closed) * 100) : 0,
    newThisMonth: clients.filter((c) => baghdadDate(c.created_at).startsWith(month)).length,
    overdueFollowUps: overdue.length,
    dueTodayFollowUps: dueToday.length,
    neglected: buildNeglected(clients, 14, today).length,
    activitiesThisPeriod: activities.filter((a) => a.activity_type !== "تغيير مرحلة").length,
    avgDaysToWin: averageDaysToWin(clients, activities),
  };
}
