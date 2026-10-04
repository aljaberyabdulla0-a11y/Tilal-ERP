import Link from "next/link";
import { requireMktRead } from "@/lib/marketing-guard";
import { baghdadDate } from "@/lib/time";
import { getCalendar, type CalendarItem } from "@/lib/marketing";
import { Badge, Card, PageHead, Unavailable } from "@/components/marketing/ui";

// ============================================================
// تقويم التسويق — شهرٌ بشبكة، وما يمتدّ أياماً (حملة، نشاط) على خطّ زمني
// تحتها. ما يقع في يومٍ واحد (نشر، مهمّة، تسليم مؤثر) في خانة يومه.
//
// الأسبوع يبدأ السبت كما في العراق. والسحب والإفلات لا يُبنى: تغيير
// تاريخ النشر قرارٌ يمرّ بحارس المحتوى، فيُعدَّل من صفحته.
// ============================================================
const KIND_DOT: Record<string, string> = {
  "حملة": "bg-brand-600", "محتوى": "bg-sky-500", "فعالية": "bg-violet-500", "ميداني": "bg-amber-500",
  "مهمّة": "bg-gray-500", "مؤثر": "bg-pink-500",
};
const WEEK = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

function monthBounds(m: string) {
  const [y, mo] = m.split("-").map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const last = new Date(Date.UTC(y, mo, 0));
  return { first, last, from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), days: last.getUTCDate() };
}
function shift(m: string, d: number) {
  const [y, mo] = m.split("-").map(Number);
  const x = new Date(Date.UTC(y, mo - 1 + d, 1));
  return x.toISOString().slice(0, 7);
}

export default async function CalendarPage({ searchParams }: { searchParams: Record<string, string> }) {
  await requireMktRead();
  const today = baghdadDate();
  const m = /^\d{4}-\d{2}$/.test(searchParams.m ?? "") ? searchParams.m : today.slice(0, 7);
  const b = monthBounds(m);
  const res = await getCalendar(b.from, b.to);
  const items = res.data;

  const spanning = items.filter((i) => i.starts !== i.ends && ["حملة", "فعالية", "ميداني"].includes(i.kind));
  const single = items.filter((i) => !spanning.includes(i));
  const byDay = new Map<string, CalendarItem[]>();
  for (const i of single) {
    const k = i.starts < b.from ? b.from : i.starts;
    byDay.set(k, [...(byDay.get(k) ?? []), i]);
  }
  // الإزاحة: كم خانة فارغة قبل اليوم الأول (السبت = ٠)
  const lead = (b.first.getUTCDay() + 1) % 7;
  const cells = Array.from({ length: lead + b.days }, (_, i) => (i < lead ? null : `${m}-${String(i - lead + 1).padStart(2, "0")}`));

  return (
    <>
      <PageHead title="التقويم" sub="الحملات والمحتوى والفعاليات والأنشطة الميدانية والمهامّ وتسليمات المؤثرين — في شهرٍ واحد."
        actions={<div className="flex items-center gap-2 text-sm">
          <Link href={`?m=${shift(m, -1)}`} className="rounded border px-2 py-1">→ السابق</Link>
          <span className="font-semibold" dir="ltr">{m}</span>
          <Link href={`?m=${shift(m, 1)}`} className="rounded border px-2 py-1">التالي ←</Link>
          <Link href="?" className="text-xs text-brand-600">اليوم</Link>
        </div>} />
      <Unavailable error={res.error} />

      <div className="flex flex-wrap gap-3 text-xs text-gray-600">
        {Object.entries(KIND_DOT).map(([k, c]) => <span key={k} className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${c}`} />{k}</span>)}
      </div>

      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <div className="grid min-w-[700px] grid-cols-7 text-xs">
          {WEEK.map((d) => <div key={d} className="border-b bg-gray-50 px-2 py-1.5 font-medium text-gray-500">{d}</div>)}
          {cells.map((d, i) => (
            <div key={i} className={`min-h-[96px] border-b border-s p-1.5 ${d === today ? "bg-brand-50" : ""}`}>
              {d && <p className={`mb-1 text-[11px] ${d === today ? "font-bold text-brand-700" : "text-gray-400"}`}>{Number(d.slice(8))}</p>}
              {d && (byDay.get(d) ?? []).slice(0, 4).map((it) => (
                <Link key={`${it.kind}-${it.id}`} href={it.href} title={`${it.kind}: ${it.title} — ${it.status}`}
                  className="mb-0.5 flex items-center gap-1 truncate rounded px-1 py-0.5 hover:bg-gray-100">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${KIND_DOT[it.kind] ?? "bg-gray-400"}`} />
                  <span className="truncate">{it.title}</span>
                </Link>
              ))}
              {d && (byDay.get(d)?.length ?? 0) > 4 && <p className="text-[10px] text-gray-400">+{(byDay.get(d)?.length ?? 0) - 4}</p>}
            </div>
          ))}
        </div>
      </section>

      <Card title="الخطّ الزمني — ما يمتدّ أياماً">
        {spanning.length === 0 ? <p className="text-sm text-gray-400">لا حملات ولا أنشطة ممتدّة في الشهر.</p> : (
          <ul className="space-y-2">
            {spanning.map((it) => {
              const s = Math.max(1, it.starts < b.from ? 1 : Number(it.starts.slice(8)));
              const e = Math.min(b.days, it.ends > b.to ? b.days : Number(it.ends.slice(8)));
              return (
                <li key={`${it.kind}-${it.id}`} className="grid grid-cols-[12rem_1fr] items-center gap-3 text-xs">
                  <Link href={it.href} className="truncate hover:text-brand-600"><span className="text-gray-400">{it.kind} · </span>{it.title}</Link>
                  <div className="relative h-4 rounded bg-gray-50" dir="ltr">
                    <div className={`absolute h-4 rounded ${KIND_DOT[it.kind] ?? "bg-gray-400"} opacity-80`}
                      style={{ left: `${((s - 1) / b.days) * 100}%`, width: `${((e - s + 1) / b.days) * 100}%` }}
                      title={`${it.starts} → ${it.ends} · ${it.status}`} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="قائمة الشهر">
        <ul className="divide-y divide-gray-100 text-sm">
          {items.map((it) => (
            <li key={`${it.kind}-${it.id}`} className="flex items-center justify-between gap-2 py-1.5">
              <Link href={it.href} className="truncate hover:text-brand-600"><span className="text-xs text-gray-400">{it.kind} · </span>{it.title}</Link>
              <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500" dir="ltr">{it.starts}{it.ends !== it.starts ? ` → ${it.ends}` : ""}<Badge>{it.status}</Badge></span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
