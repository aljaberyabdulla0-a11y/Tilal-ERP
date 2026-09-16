import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { Task, isOpenTask } from "@/lib/types";
import { baghdadDate } from "@/lib/time";
import { getUnworkedLeads, TEMPERATURE_STYLE, scoreStyle } from "@/lib/crm";
import CrmTabs from "../crm-tabs";

// ============================================================
// «يومي» — مساحة عمل الموظف.
//
// السؤال الذي تجيب عنه الشاشة: **ماذا أفعل الآن؟**
//
// وترتيب الأقسام هو الجواب مرتّباً، ولا يُغيَّر بلا سبب:
//
//     ١) متأخر        فات وقته — يُعالَج قبل كل شيء
//     ٢) اليوم        موعده الآن
//     ٣) لم يُلمَس    أُسنِد ولم يُتواصَل معه قطّ
//     ٤) ساخن يبرد    قيّم وصامت — أغلى ما يُفقَد بالإهمال
//     ٥) مهامّي       ما كُلّفت به
//
// وليست لوحة مؤشّرات. الموظف لا يحتاج أن يعرف «معدّل تحويله» في
// التاسعة صباحاً — يحتاج أن يعرف بمن يتّصل. الأرقام في لوحة
// الإدارة، والأسماء هنا.
//
// كل بطاقة تحمل **سببها**: «صامت منذ ١٨ يوماً ودرجته ٧٢» لا
// «ليد ساخن». والسبب هو ما يجعل الموظف يتصرّف.
// ============================================================

type ClientRow = {
  id: string;
  name: string;
  phone: string | null;
  stage: string;
  follow_up_date: string | null;
  last_contact_at: string | null;
  lead_score: number | null;
  lead_temperature: string | null;
};

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default async function CrmTodayPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const today = baghdadDate();

  // RLS تحصر النتائج في ليدات القارئ تلقائياً (sql/071)، فلا نُرشِّح
  // بالمالك هنا: المشرف يرى نطاقه والموظف يرى نفسه بنفس الاستعلام.
  const [{ data: clientData }, { data: taskData }, unworked] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, phone, stage, follow_up_date, last_contact_at, lead_score, lead_temperature"
      )
      .is("deleted_at", null)
      .not("stage", "in", '("بيع","فشل البيع")')
      .order("follow_up_date", { ascending: true, nullsFirst: false })
      .limit(500),
    supabase
      .from("tasks")
      .select("*")
      .eq("assigned_to", user.id)
      .order("due_date", { ascending: true })
      .limit(50),
    getUnworkedLeads(),
  ]);

  const clients = (clientData ?? []) as ClientRow[];
  const tasks = ((taskData ?? []) as Task[]).filter((t) => isOpenTask(t.status));

  const overdue = clients.filter(
    (c) => c.follow_up_date !== null && c.follow_up_date < today
  );
  const dueToday = clients.filter((c) => c.follow_up_date === today);
  const untouched = clients.filter((c) => c.last_contact_at === null).slice(0, 30);

  // ساخن يبرد: درجة عالية وصمت طويل. الترتيب بالأغلى فالأقل.
  const coolingHot = clients
    .filter(
      (c) =>
        (c.lead_score ?? 0) >= 60 &&
        c.last_contact_at !== null &&
        daysSince(c.last_contact_at) >= 10
    )
    .sort((a, b) => (b.lead_score ?? 0) - (a.lead_score ?? 0))
    .slice(0, 15);

  const myUnworked = unworked.length;

  return (
    <div>
      <CrmTabs active="today" />

      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-brand-600">يومي</h1>
            <p className="mt-1 text-sm text-gray-500">
              مرتّبة بالأولوية — ابدأ من الأعلى.
            </p>
          </div>
          <span className="text-sm text-gray-500">{today}</span>
        </header>

        {/* شريط العدّ — أرقام قابلة للنقر لا زينة */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Counter label="متأخر" value={overdue.length} tone="red" />
          <Counter label="اليوم" value={dueToday.length} tone="amber" />
          <Counter label="لم يُلمَس" value={myUnworked} tone="amber" />
          <Counter label="مهامّي" value={tasks.length} tone="brand" />
        </div>

        <ClientSection
          title="متأخر"
          hint="فات موعد متابعتهم — هؤلاء أولاً."
          tone="red"
          rows={overdue}
          reason={(c) => `فات الموعد بـ${daysSince(c.follow_up_date)} يوماً`}
        />

        <ClientSection
          title="متابعات اليوم"
          hint="موعدهم اليوم."
          tone="amber"
          rows={dueToday}
          reason={() => "موعد المتابعة اليوم"}
        />

        <ClientSection
          title="لم يُتواصَل معهم قطّ"
          hint="أُسنِدوا إليك ولم يُسجَّل عليهم تواصل واحد."
          tone="amber"
          rows={untouched}
          reason={(c) => `أُسنِد منذ ${daysSince(c.last_contact_at)} يوماً`}
        />

        <ClientSection
          title="قيّمون ويبردون"
          hint="درجتهم عالية وصمتهم طال — أغلى ما يُفقَد بالإهمال."
          tone="brand"
          rows={coolingHot}
          reason={(c) =>
            `درجته ${c.lead_score} وصامت منذ ${daysSince(c.last_contact_at)} يوماً`
          }
        />

        {/* ===== المهام ===== */}
        <section>
          <h2 className="mb-3 font-bold text-gray-800">مهامّي</h2>
          {tasks.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-white px-5 py-6 text-center text-sm text-gray-400">
              لا مهامّ مفتوحة.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <Link
                      href={`/dashboard/tasks/${t.id}/edit`}
                      className="font-medium text-gray-800 hover:text-brand-600"
                    >
                      {t.title}
                    </Link>
                    {t.next_step && (
                      <p className="text-xs text-gray-500">الخطوة القادمة: {t.next_step}</p>
                    )}
                  </div>
                  <span
                    className={
                      t.due_date < today
                        ? "whitespace-nowrap text-sm font-semibold text-red-700"
                        : "whitespace-nowrap text-sm text-gray-500"
                    }
                  >
                    {t.due_date}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ============================================================
// المكوّنات المساعدة — داخل الملف لأنها لا تُستعمل خارج هذه الشاشة.
// ============================================================

const TONES: Record<string, { box: string; text: string }> = {
  red: { box: "border-red-200 bg-red-50", text: "text-red-700" },
  amber: { box: "border-amber-200 bg-amber-50", text: "text-amber-700" },
  brand: { box: "border-brand-200 bg-brand-50", text: "text-brand-700" },
};

function Counter({ label, value, tone }: { label: string; value: number; tone: string }) {
  const t = TONES[tone] ?? TONES.brand;
  return (
    <div className={`rounded-lg border p-4 ${t.box}`}>
      <p className={`text-2xl font-bold ${t.text}`}>{value}</p>
      <p className="text-xs text-gray-600">{label}</p>
    </div>
  );
}

function ClientSection({
  title,
  hint,
  tone,
  rows,
  reason,
}: {
  title: string;
  hint: string;
  tone: string;
  rows: ClientRow[];
  reason: (c: ClientRow) => string;
}) {
  // القسم الفارغ يختفي: قائمةٌ فارغة تحت عنوان تُربك أكثر مما تُفيد
  if (rows.length === 0) return null;
  const t = TONES[tone] ?? TONES.brand;

  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className={`font-bold ${t.text}`}>{title}</h2>
        <span className="text-sm text-gray-400">({rows.length})</span>
      </div>
      <p className="mb-3 text-xs text-gray-500">{hint}</p>

      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Link
              href={`/dashboard/clients/${c.id}`}
              className="font-medium text-gray-800 hover:text-brand-600"
            >
              {c.name}
            </Link>

            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {c.stage}
            </span>

            {c.lead_score !== null && (
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${scoreStyle(c.lead_score)}`}>
                {c.lead_score}
              </span>
            )}

            {c.lead_temperature && (
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  TEMPERATURE_STYLE[c.lead_temperature] ?? "bg-gray-100 text-gray-500"
                }`}
              >
                {c.lead_temperature}
              </span>
            )}

            {/* السبب — هو ما يجعل الصفّ قابلاً للتصرّف */}
            <span className="text-xs text-gray-500">{reason(c)}</span>

            {c.phone && (
              <a
                href={`tel:${c.phone}`}
                className="ms-auto rounded-lg border border-brand-600 px-3 py-1 text-xs font-semibold text-brand-600 transition hover:bg-brand-50"
              >
                اتّصل
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
