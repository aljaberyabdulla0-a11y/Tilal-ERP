import { compareValues, type Delta } from "@/lib/report-engine";

// ============================================================
// ⚠️ بيانات تجريبية للعرض فقط — MOCK DATA, PRESENTATION ONLY.
//
// لا شيء هنا يُقرأ من القاعدة ولا يُكتب إليها. الأرقام مولَّدة بمولّد
// عشوائي ثابت البذرة (من التاريخ والمُرشِّحات)، فتتغيّر مع المُرشِّح
// تغيّراً معقولاً وتبقى هي نفسها كلما عُدت إلى نفس المُرشِّح.
//
// أسماء المشاريع والعملاء والموظفين مختلَقة. والواجهة تعلن ذلك في
// شريط المعاينة وعلى شارة كل قسم.
//
// الشيء الوحيد المستعار من النظام: compareValues من محرّك التقارير،
// كي يُحكم على التغيّر (جيد/سيئ) بنفس منطق اللوحة الحقيقية حرفاً —
// ارتفاع دورة البيع «سيئ» وإن كان سهمه للأعلى.
// ============================================================

export type Bi = { ar: string; en: string };
export type Preset = "today" | "this_week" | "this_month" | "last_month" | "this_quarter" | "this_year" | "custom";
export type Grain = "day" | "week" | "month";
export type Range = { from: string; to: string };

export type MockFilters = {
  preset: Preset;
  custom: Range | null;
  project: string | null;
  team: string | null;
  source: string | null;
};

export const PRESETS: Exclude<Preset, "custom">[] = ["today", "this_week", "this_month", "last_month", "this_quarter", "this_year"];

export const MOCK_PROJECTS: { id: string; name: Bi; total: number; sold: number; reserved: number; weight: number }[] = [
  { id: "p1", name: { ar: "تلال الربيع", en: "Tilal Al-Rabee" }, total: 240, sold: 168, reserved: 22, weight: 0.34 },
  { id: "p2", name: { ar: "مجمّع النخيل", en: "Al-Nakheel Compound" }, total: 180, sold: 97, reserved: 18, weight: 0.24 },
  { id: "p3", name: { ar: "أبراج دجلة", en: "Dijla Towers" }, total: 132, sold: 51, reserved: 14, weight: 0.17 },
  { id: "p4", name: { ar: "واحة الكرخ", en: "Karkh Oasis" }, total: 96, sold: 70, reserved: 6, weight: 0.13 },
  { id: "p5", name: { ar: "حدائق المنصور", en: "Mansour Gardens" }, total: 64, sold: 19, reserved: 5, weight: 0.08 },
  { id: "p6", name: { ar: "بوابة بغداد", en: "Baghdad Gate" }, total: 48, sold: 6, reserved: 2, weight: 0.04 },
];

export const MOCK_SOURCES: { id: string; name: Bi; weight: number }[] = [
  { id: "facebook", name: { ar: "فيسبوك", en: "Facebook" }, weight: 0.36 },
  { id: "instagram", name: { ar: "إنستغرام", en: "Instagram" }, weight: 0.2 },
  { id: "tiktok", name: { ar: "تيك توك", en: "TikTok" }, weight: 0.12 },
  { id: "walkin", name: { ar: "زيارة مباشرة", en: "Walk-in" }, weight: 0.11 },
  { id: "referral", name: { ar: "توصية", en: "Referral" }, weight: 0.13 },
  { id: "broker", name: { ar: "شركة وسيطة", en: "Broker company" }, weight: 0.08 },
];

// الفرق في النظام فرقُ مشرفي المشاريع — فاسم الفريق اسم مشروعه
export const MOCK_TEAMS = MOCK_PROJECTS.map((p) => ({ id: `t-${p.id}`, project: p.id, name: p.name }));

// ===== التواريخ (بتوقيت بغداد، نصّاً YYYY-MM-DD) =====

const DAY = 86_400_000;

export function baghdadToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function toDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}
function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  return toIso(new Date(toDate(iso).getTime() + n * DAY));
}
export function daysBetween(r: Range): number {
  return Math.round((toDate(r.to).getTime() - toDate(r.from).getTime()) / DAY) + 1;
}

export function rangeFor(preset: Preset, today: string, custom: Range | null): Range {
  const d = toDate(today);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "this_week": {
      // الأسبوع في العراق يبدأ السبت
      const back = (d.getUTCDay() + 1) % 7;
      return { from: addDays(today, -back), to: today };
    }
    case "last_month":
      return { from: toIso(new Date(Date.UTC(y, m - 1, 1, 12))), to: toIso(new Date(Date.UTC(y, m, 0, 12))) };
    case "this_quarter":
      return { from: toIso(new Date(Date.UTC(y, m - (m % 3), 1, 12))), to: today };
    case "this_year":
      return { from: `${y}-01-01`, to: today };
    case "custom":
      return custom ?? { from: toIso(new Date(Date.UTC(y, m, 1, 12))), to: today };
    default:
      return { from: toIso(new Date(Date.UTC(y, m, 1, 12))), to: today };
  }
}

// الفترة السابقة: نفس الطول ملاصقةً قبلها
export function previousOf(r: Range): Range {
  const n = daysBetween(r);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

export function defaultGrain(r: Range): Grain {
  const n = daysBetween(r);
  return n <= 31 ? "day" : n <= 120 ? "week" : "month";
}

// ===== مولّد ثابت البذرة =====

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rand(seed: string): number {
  let t = (hash(seed) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function scopeFactor(f: MockFilters): number {
  let k = 1;
  const p = MOCK_PROJECTS.find((x) => x.id === f.project);
  if (p) k *= p.weight;
  const team = MOCK_TEAMS.find((x) => x.id === f.team);
  if (team) k *= f.project ? (team.project === f.project ? 1 : 0.08) : MOCK_PROJECTS.find((x) => x.id === team.project)!.weight;
  const s = MOCK_SOURCES.find((x) => x.id === f.source);
  if (s) k *= s.weight;
  return k;
}

function scopeKey(f: MockFilters): string {
  return `${f.project ?? "*"}|${f.team ?? "*"}|${f.source ?? "*"}`;
}

type Day = { date: string; deals: number; revenue: number };

function dayOf(date: string, f: MockFilters): Day {
  const dow = toDate(date).getUTCDay();
  const weekday = dow === 5 ? 0.25 : dow === 6 ? 0.8 : 1; // الجمعة عطلة
  const lambda = 0.62 * weekday * scopeFactor(f) * 1.6;
  const deals = Math.floor(lambda + rand(`${date}|${scopeKey(f)}|n`) * 1.05);
  let revenue = 0;
  for (let i = 0; i < deals; i++) revenue += 150_000_000 + Math.round(rand(`${date}|${i}|v`) * 34) * 5_000_000;
  return { date, deals, revenue };
}

function daysIn(r: Range, f: MockFilters): Day[] {
  const n = daysBetween(r);
  return Array.from({ length: n }, (_, i) => dayOf(addDays(r.from, i), f));
}

// ===== الاتجاه =====

export type MockBucket = { key: string; current: number; previous: number | null };

function bucketKey(date: string, g: Grain): string {
  if (g === "month") return date.slice(0, 7);
  if (g === "week") {
    const back = (toDate(date).getUTCDay() + 1) % 7;
    return addDays(date, -back);
  }
  return date;
}

function bucketize(days: Day[], g: Grain): { key: string; value: number }[] {
  const out: { key: string; value: number }[] = [];
  for (const d of days) {
    const k = bucketKey(d.date, g);
    const last = out[out.length - 1];
    if (last && last.key === k) last.value += d.revenue;
    else out.push({ key: k, value: d.revenue });
  }
  return out;
}

// ===== المؤشّرات =====

export type MockKpi = { value: number | null; delta: Delta | null };

export type MockDashboard = {
  range: Range;
  previous: Range;
  grain: Grain;
  trend: MockBucket[];
  weekly12: number[];
  kpi: Record<
    | "sales" | "collected" | "net" | "reservations"
    | "won" | "available" | "active" | "conversion"
    | "leads" | "acts" | "avg" | "cycle" | "lost" | "wpipe",
    MockKpi
  >;
  unitsTotal: number;
  funnel: { key: string; label: Bi; value: number; conversion: number | null }[];
  completed: number;
};

function periodTotals(days: Day[], f: MockFilters, tag: string) {
  const revenue = days.reduce((s, d) => s + d.revenue, 0);
  const won = days.reduce((s, d) => s + d.deals, 0);
  const n = days.length;
  const k = scopeFactor(f);
  const r = (x: string) => rand(`${tag}|${scopeKey(f)}|${x}`);
  const collected = Math.round(revenue * 0.031 + n * 520_000 * Math.sqrt(k));
  const expense = Math.round(n * 1_480_000 * (0.4 + 0.6 * Math.sqrt(k)) * (0.85 + r("e") * 0.35));
  const lost = Math.round(won * 1.7 + r("l") * 3 * Math.max(1, n / 30));
  const leads = Math.round(won * 24 + n * 3.1 * k * 6 + r("nl") * 12);
  return {
    revenue, won, collected, net: collected - expense,
    reservations: Math.round(won * 1.45 + r("res") * 3),
    active: Math.round(1180 * k + r("a") * 60 * k + 12),
    conversion: won + lost > 0 ? Math.round((won / (won + lost)) * 1000) / 10 : null,
    leads,
    acts: Math.round(leads * 3.3 + r("ac") * 40),
    avg: won > 0 ? Math.round(revenue / won) : null,
    cycle: won > 0 ? Math.round(31 + r("cy") * 14) : null,
    lost,
    wpipe: Math.round(6_400_000_000 * k * (0.9 + r("wp") * 0.25)),
  };
}

export function buildDashboard(f: MockFilters, today: string, grainOverride: Grain | null): MockDashboard {
  const range = rangeFor(f.preset, today, f.custom);
  const previous = previousOf(range);
  const grain = grainOverride ?? defaultGrain(range);
  const curDays = daysIn(range, f);
  const prevDays = daysIn(previous, f);

  const cb = bucketize(curDays, grain);
  const pb = bucketize(prevDays, grain);
  // مربوطتان بالموضع: اليوم الثالث مقابل الثالث (كاللوحة الحقيقية)
  const trend = cb.map((b, i) => ({ key: b.key, current: b.value, previous: pb[i] ? pb[i].value : null }));

  const weekly12 = Array.from({ length: 12 }, (_, w) => {
    const end = addDays(today, -7 * (11 - w));
    return daysIn({ from: addDays(end, -6), to: end }, f).reduce((s, d) => s + d.revenue, 0);
  });

  const c = periodTotals(curDays, f, `${range.from}:${range.to}`);
  const p = periodTotals(prevDays, f, `${previous.from}:${previous.to}`);
  const cmp = (cur: number | null, prev: number | null, good: "up" | "down" | null): MockKpi => ({
    value: cur,
    delta: compareValues(cur, prev, good),
  });

  const projects = f.project ? MOCK_PROJECTS.filter((x) => x.id === f.project) : MOCK_PROJECTS;
  const available = projects.reduce((s, x) => s + (x.total - x.sold - x.reserved), 0);
  const unitsTotal = projects.reduce((s, x) => s + x.total, 0);

  const reached = [c.leads, Math.round(c.leads * 0.81), Math.round(c.leads * 0.44), Math.round(c.leads * 0.19), c.reservations, c.won];
  const labels: Bi[] = [
    { ar: "ليد جديد", en: "New lead" },
    { ar: "تواصل", en: "Contacted" },
    { ar: "مؤهَّل", en: "Qualified" },
    { ar: "زيارة موقع", en: "Site visit" },
    { ar: "حجز", en: "Reservation" },
    { ar: "بيع", en: "Sale" },
  ];

  return {
    range, previous, grain, trend, weekly12, unitsTotal,
    completed: Math.max(0, c.won - Math.round(rand(`${range.from}|cmp`) * 2)),
    kpi: {
      sales: cmp(c.revenue, p.revenue, "up"),
      collected: cmp(c.collected, p.collected, "up"),
      net: cmp(c.net, p.net, "up"),
      reservations: cmp(c.reservations, p.reservations, "up"),
      won: cmp(c.won, p.won, "up"),
      available: { value: available, delta: null },
      active: cmp(c.active, p.active, null),
      conversion: cmp(c.conversion, p.conversion, "up"),
      leads: cmp(c.leads, p.leads, "up"),
      acts: cmp(c.acts, p.acts, "up"),
      avg: cmp(c.avg, p.avg, "up"),
      cycle: cmp(c.cycle, p.cycle, "down"),
      lost: cmp(c.lost, p.lost, "down"),
      wpipe: cmp(c.wpipe, p.wpipe, "up"),
    },
    funnel: reached.map((v, i) => ({
      key: String(i),
      label: labels[i],
      value: v,
      conversion: i === 0 || reached[i - 1] === 0 ? null : Math.round((v / reached[i - 1]) * 1000) / 10,
    })),
  };
}

// ===== المشاريع (للفترة) =====

export type MockProjectRow = {
  id: string; name: Bi; total: number; available: number; reserved: number; sold: number;
  sellThrough: number; revenue: number; reservations: number;
};

export function buildProjects(f: MockFilters, today: string): MockProjectRow[] {
  const range = rangeFor(f.preset, today, f.custom);
  return MOCK_PROJECTS.filter((p) => !f.project || p.id === f.project).map((p) => {
    const days = daysIn(range, { ...f, project: p.id, team: null });
    const won = days.reduce((s, d) => s + d.deals, 0);
    return {
      id: p.id, name: p.name, total: p.total, sold: p.sold, reserved: p.reserved,
      available: p.total - p.sold - p.reserved,
      sellThrough: Math.round((p.sold / p.total) * 1000) / 10,
      revenue: days.reduce((s, d) => s + d.revenue, 0),
      reservations: Math.round(won * 1.4 + rand(`${p.id}|${range.from}`) * 2),
    };
  });
}

// ===== المال (لقطة الآن + آخر 6 أشهر — لا تتبع الفترة، كاللوحة الحقيقية) =====

export function buildMoney(today: string, projectId: string | null) {
  const k = projectId ? MOCK_PROJECTS.find((p) => p.id === projectId)?.weight ?? 1 : 1;
  const d = toDate(today);
  const months = Array.from({ length: 6 }, (_, i) => {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (5 - i), 1, 12));
    const key = toIso(m).slice(0, 7);
    const income = Math.round((88 + rand(`${key}|in`) * 64) * 1_000_000 * (0.3 + 0.7 * k));
    const expense = Math.round((41 + rand(`${key}|ex`) * 22) * 1_000_000 * (0.5 + 0.5 * k));
    return { key, income, expense };
  });
  const cur = months[months.length - 1];
  const cats: { label: Bi; share: number }[] = [
    { label: { ar: "الرواتب والأجور", en: "Salaries and wages" }, share: 0.46 },
    { label: { ar: "الإعلانات الممولة", en: "Paid advertising" }, share: 0.21 },
    { label: { ar: "عمولات الوسطاء", en: "Broker commissions" }, share: 0.13 },
    { label: { ar: "إيجار المكاتب", en: "Office rent" }, share: 0.1 },
    { label: { ar: "مصاريف إدارية", en: "Administrative" }, share: 0.06 },
    { label: { ar: "أخرى", en: "Other" }, share: 0.04 },
  ];
  return {
    cash: Math.round(318_400_000 * (0.4 + 0.6 * k)),
    monthIncome: cur.income,
    monthExpense: cur.expense,
    payrollDue: 46_200_000,
    partnerDue: 22_750_000,
    developerDue: Math.round(61_300_000 * k),
    months,
    byCategory: cats.map((c) => ({ label: c.label, amount: Math.round(cur.expense * c.share) })),
  };
}

// ===== يحتاج انتباهك =====
// العناوين والأوصاف من قاموس النظام (t.dash.attention.items) — هنا العدّ وحده.

export type AttentionKey =
  | "sla" | "unworked" | "overCapacity" | "silentOwners" | "saleRequests" | "reservationsExpired"
  | "reservationsExpiring" | "brokerRequests" | "brokerLeads" | "approvals" | "leaves" | "inventory" | "tasks";

export const MOCK_ATTENTION: { key: AttentionKey; severity: "critical" | "high" | "medium" | "low"; icon: string; count: number; href: string }[] = [
  { key: "sla", severity: "critical", icon: "timer_off", count: 7, href: "/dashboard/crm/reports/analysis#sla" },
  { key: "unworked", severity: "high", icon: "person_off", count: 12, href: "/dashboard/crm/distribution" },
  { key: "saleRequests", severity: "high", icon: "gavel", count: 4, href: "/dashboard/reservations" },
  { key: "reservationsExpired", severity: "high", icon: "event_busy", count: 1, href: "/dashboard/reservations" },
  { key: "approvals", severity: "high", icon: "approval", count: 8, href: "/dashboard/me/approvals" },
  { key: "overCapacity", severity: "medium", icon: "group_work", count: 2, href: "/dashboard/crm/distribution" },
  { key: "silentOwners", severity: "medium", icon: "notifications_paused", count: 3, href: "/dashboard/crm/distribution" },
  { key: "reservationsExpiring", severity: "medium", icon: "event_upcoming", count: 5, href: "/dashboard/reservations" },
  { key: "brokerRequests", severity: "medium", icon: "real_estate_agent", count: 3, href: "/dashboard/brokers/requests" },
  { key: "brokerLeads", severity: "medium", icon: "hourglass_bottom", count: 6, href: "/dashboard/brokers/leads" },
  { key: "tasks", severity: "medium", icon: "assignment_late", count: 11, href: "/dashboard/tasks" },
  { key: "inventory", severity: "medium", icon: "inventory", count: 0, href: "/dashboard/inventory?state=low" },
  { key: "leaves", severity: "low", icon: "beach_access", count: 2, href: "/dashboard/hr/leaves" },
];
export const MOCK_UNWORKED_DAYS = 9;

// ===== النشاط والمهام والإشعارات =====

export type ActivityKind = "lead_created" | "won" | "reservation" | "payment" | "activity" | "broker_request" | "task_completed" | "lost";

export const MOCK_ACTIVITY: { id: string; kind: ActivityKind; subject: Bi; by: Bi; minutesAgo: number; amount?: number }[] = [
  { id: "a1", kind: "won", subject: { ar: "علي حسين — تلال الربيع A-1204", en: "Ali Hussein — Tilal Al-Rabee A-1204" }, by: { ar: "سارة عبد الله", en: "Sara Abdullah" }, minutesAgo: 12, amount: 214_000_000 },
  { id: "a2", kind: "payment", subject: { ar: "دفعة مقدّمة — مجمّع النخيل B-07", en: "Down payment — Al-Nakheel B-07" }, by: { ar: "حيدر جاسم", en: "Haider Jasim" }, minutesAgo: 34, amount: 32_500_000 },
  { id: "a3", kind: "reservation", subject: { ar: "زينب كاظم — أبراج دجلة T2-15", en: "Zainab Kadhim — Dijla Towers T2-15" }, by: { ar: "مصطفى ناصر", en: "Mustafa Nasser" }, minutesAgo: 58 },
  { id: "a4", kind: "broker_request", subject: { ar: "طلب حجز من شركة الرافدين للوساطة", en: "Reservation request from Al-Rafidain Brokerage" }, by: { ar: "شركة وسيطة", en: "Broker company" }, minutesAgo: 75 },
  { id: "a5", kind: "lead_created", subject: { ar: "محمد صالح — حملة فيسبوك أكتوبر", en: "Mohammed Saleh — October Facebook campaign" }, by: { ar: "نور الهدى", en: "Noor Al-Huda" }, minutesAgo: 96 },
  { id: "a6", kind: "activity", subject: { ar: "زيارة موقع مع عائلة الجبوري", en: "Site visit with the Al-Jubouri family" }, by: { ar: "سارة عبد الله", en: "Sara Abdullah" }, minutesAgo: 140 },
  { id: "a7", kind: "lost", subject: { ar: "رنا فاضل — السعر أعلى من الميزانية", en: "Rana Fadhil — price above budget" }, by: { ar: "حيدر جاسم", en: "Haider Jasim" }, minutesAgo: 205 },
  { id: "a8", kind: "task_completed", subject: { ar: "تجهيز عقود الدفعة الثانية — واحة الكرخ", en: "Prepare batch-two contracts — Karkh Oasis" }, by: { ar: "ليلى مهدي", en: "Layla Mahdi" }, minutesAgo: 260 },
];

export const MOCK_TASKS: { id: string; title: Bi; due: Bi; late: boolean }[] = [
  { id: "k1", title: { ar: "اعتماد طلب تحويل حجز T2-15 إلى بيع", en: "Approve converting reservation T2-15 to a sale" }, due: { ar: "متأخرة يوماً", en: "1 day late" }, late: true },
  { id: "k2", title: { ar: "مراجعة تقرير الحملات الأسبوعي", en: "Review the weekly campaign report" }, due: { ar: "اليوم 1:00 م", en: "Today 1:00 PM" }, late: false },
  { id: "k3", title: { ar: "توقيع كشف رواتب أكتوبر", en: "Sign the October payroll" }, due: { ar: "اليوم 4:00 م", en: "Today 4:00 PM" }, late: false },
  { id: "k4", title: { ar: "اجتماع مع مطوّر بوابة بغداد", en: "Meeting with the Baghdad Gate developer" }, due: { ar: "اليوم 6:30 م", en: "Today 6:30 PM" }, late: false },
];

export const MOCK_NOTIFICATIONS: { id: string; icon: string; title: Bi; body: Bi; minutesAgo: number; unread: boolean }[] = [
  { id: "n1", icon: "gavel", title: { ar: "طلب تحويل حجز إلى بيع", en: "Reservation-to-sale request" }, body: { ar: "مصطفى ناصر طلب تحويل T2-15 في أبراج دجلة.", en: "Mustafa Nasser asked to convert T2-15 in Dijla Towers." }, minutesAgo: 8, unread: true },
  { id: "n2", icon: "approval", title: { ar: "إجازة بانتظار قرارك", en: "Leave awaiting your decision" }, body: { ar: "ليلى مهدي — 3 أيام من 2 نوفمبر.", en: "Layla Mahdi — 3 days from 2 November." }, minutesAgo: 41, unread: true },
  { id: "n3", icon: "timer_off", title: { ar: "خرق مستوى الخدمة", en: "Service-level breach" }, body: { ar: "4 ليدات تجاوزت مهلة الرد الأول.", en: "4 leads passed the first-response deadline." }, minutesAgo: 95, unread: true },
  { id: "n4", icon: "payments", title: { ar: "دفعة مقبوضة", en: "Payment received" }, body: { ar: "32.5 مليون د.ع — مجمّع النخيل B-07.", en: "IQD 32.5M — Al-Nakheel B-07." }, minutesAgo: 34 * 6, unread: false },
];
