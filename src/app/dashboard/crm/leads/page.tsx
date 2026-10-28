import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { baghdadDate, baghdadDateLabel } from "@/lib/time";
import {
  PROVIDER_LABEL,
  channelLabel,
  getImportBatches,
  getIntakeQueue,
  getLeadBreakdown,
  getLeadHubSummary,
  minutesLabel,
  pct,
  type BreakdownDim,
} from "@/lib/leads";
import CrmTabs from "../crm-tabs";
import IntakeActions from "./intake-actions";

// ============================================================
// «مركز الليدات» (218) — هل وصل كل ليد، ومن يحمله، وماذا صار به؟
//
// الترتيب مقصود:
//   ١) هل الأرقام نهائية؟ مصدرٌ غير موصول أو أخطاء معلّقة تُقال أولاً،
//      لأن رقماً ناقصاً يُعرض كاملاً أخطر من رقمٍ غائب.
//   ٢) ما ينتظر الآن (الطوابير الحيّة) — هذا ما يُعمل عليه اليوم.
//   ٣) ما حدث في الفترة — الاستلام والاستجابة والتحويل.
//   ٤) التفصيل والمطابقة والأخطاء والدفعات في تبويبات.
// ============================================================

type Tab = "overview" | "errors" | "reconcile" | "batches";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "الأداء" },
  { key: "errors", label: "قائمة الأخطاء" },
  { key: "reconcile", label: "المطابقة" },
  { key: "batches", label: "دفعات الاستيراد" },
];
const DIMS: { key: BreakdownDim; label: string }[] = [
  { key: "campaign", label: "الحملة" },
  { key: "provider", label: "الباب" },
  { key: "channel", label: "القناة" },
  { key: "owner", label: "الموظف" },
  { key: "project", label: "المشروع" },
];

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function LeadHubPage({
  searchParams,
}: {
  searchParams: { tab?: string; dim?: string; from?: string; to?: string };
}) {
  const supabase = await createClient();
  const [{ data: canView }, { data: canManage }, { data: canImport }] = await Promise.all([
    supabase.rpc("can_view_lead_hub"),
    supabase.rpc("can_manage_lead_intake"),
    supabase.rpc("can_import_leads"),
  ]);
  if (canView !== true) redirect("/dashboard/crm/leads/capture");

  const today = baghdadDate();
  const to = isDate(searchParams.to) ? searchParams.to! : today;
  const from = isDate(searchParams.from) ? searchParams.from! : baghdadDate(Date.now() - 29 * 86400000);
  const tab: Tab = (TABS.find((t) => t.key === searchParams.tab)?.key ?? "overview") as Tab;
  const dim: BreakdownDim = (DIMS.find((d) => d.key === searchParams.dim)?.key ?? "campaign") as BreakdownDim;
  const qs = (patch: Record<string, string>) =>
    "/dashboard/crm/leads?" + new URLSearchParams({ from, to, tab, dim, ...patch }).toString();

  const [summary, breakdown, queue, batches] = await Promise.all([
    getLeadHubSummary(from, to),
    tab === "overview" || tab === "reconcile"
      ? getLeadBreakdown(from, to, tab === "reconcile" ? "campaign" : dim)
      : Promise.resolve({ data: [], error: null }),
    tab === "errors" ? getIntakeQueue() : Promise.resolve({ data: [], error: null }),
    tab === "batches" ? getImportBatches() : Promise.resolve([]),
  ]);
  const s = summary.data;

  return (
    <div>
      <CrmTabs active="leads" />
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-600">مركز الليدات</h1>
            <p className="mt-1 text-sm text-gray-500">
              كل ليد وصل إلى تلال: مسجَّل، أو مربوط بعميل قائم، أو في قائمة أخطاء تنتظر قراراً.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/crm/leads/capture" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              تسجيل ليد
            </Link>
            {canImport === true && (
              <Link href="/dashboard/crm/leads/import" className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-600 hover:bg-brand-50">
                استيراد Lead Sheet
              </Link>
            )}
          </div>
        </header>

        <form className="flex flex-wrap items-end gap-2 text-sm" action="/dashboard/crm/leads">
          <input type="hidden" name="tab" value={tab} />
          <input type="hidden" name="dim" value={dim} />
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">من</span>
            <input type="date" name="from" defaultValue={from} className="rounded border px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">إلى</span>
            <input type="date" name="to" defaultValue={to} className="rounded border px-2 py-1" />
          </label>
          <button className="rounded border px-3 py-1.5 hover:bg-gray-50">تطبيق</button>
        </form>

        {summary.error && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            تعذّر حساب اللوحة: {summary.error}. إن كانت الهجرة 218 لم تُطبَّق بعد فهذه الشاشة لا تعمل قبلها.
          </p>
        )}

        {s && (
          <>
            {/* ===== ١) هل الأرقام نهائية؟ ===== */}
            <Completeness s={s} />

            {/* ===== ٢) ما ينتظر الآن ===== */}
            <section>
              <h2 className="mb-3 font-bold text-gray-800">ما ينتظر الآن</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <Tile label="بلا مسؤول" value={s.q_unassigned} tone={s.q_unassigned ? "bad" : "ok"} href="/dashboard/clients?owner=none" />
                <Tile label="بانتظار أول تواصل" value={s.q_no_contact} tone={s.q_no_contact ? "warn" : "ok"} href="/dashboard/clients?contact=never" />
                <Tile label={`تجاوز مهلة أول تواصل (${s.sla_hours} س)`} value={s.q_overdue} tone={s.q_overdue ? "bad" : "ok"} href="/dashboard/crm/distribution" />
                <Tile label="متابعات فات موعدها" value={s.q_followup_late} tone={s.q_followup_late ? "warn" : "ok"} />
                <Tile label="أخطاء استقبال" value={s.q_errors} tone={s.q_errors ? "bad" : "ok"} href={qs({ tab: "errors" })} />
                <Tile label="مرفوض بانتظار تصحيح" value={s.q_rejected} tone={s.q_rejected ? "warn" : "ok"} href={qs({ tab: "errors" })} />
              </div>
            </section>

            {/* ===== ٣) الفترة ===== */}
            <section>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-bold text-gray-800">الفترة {from} ← {to}</h2>
                <span className="text-xs text-gray-500">
                  اليوم {s.today} · آخر ٧ أيام {s.week} · هذا الشهر {s.month}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
                <Tile label="وصل" value={s.received} />
                <Tile label="عميل جديد" value={s.created} sub={pct(s.created, s.received)} />
                <Tile label="عميل قائم (رُبط)" value={s.linked} sub={pct(s.linked, s.received)} />
                <Tile label="مرفوض / معلّق" value={s.rejected + s.pending} tone={s.rejected + s.pending ? "warn" : undefined} />
                <Tile label="أُسند لموظف" value={s.assigned} sub={pct(s.assigned, s.created + s.linked)} />
                <Tile label="تمّ التواصل" value={s.contacted} sub={pct(s.contacted, s.created + s.linked)} />
                <Tile label={`ضمن المهلة (${s.sla_hours} س)`} value={s.in_sla} sub={pct(s.in_sla, s.created + s.linked)} tone="brand" />
                <Tile label="زمن أول استجابة" text={minutesLabel(s.avg_first_min)} sub={`الوسيط ${minutesLabel(s.median_first_min)}`} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Tile label="حجز" value={s.reserved} sub={pct(s.reserved, s.created)} />
                <Tile label="بيع" value={s.sold} sub={`تحويل ليد ← بيع ${pct(s.sold, s.created)}`} tone="brand" />
                <div className="col-span-2 rounded-lg border bg-white p-3 text-xs text-gray-600">
                  <p className="mb-1 font-semibold text-gray-700">حسب الباب</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(s.by_provider).sort((a, b) => b[1] - a[1]).map(([p, n]) => (
                      <span key={p} className="rounded-full bg-gray-100 px-2 py-0.5">{PROVIDER_LABEL[p] ?? p}: {n}</span>
                    ))}
                    {Object.keys(s.by_provider).length === 0 && <span>لا شيء في الفترة.</span>}
                  </div>
                </div>
              </div>
            </section>

            {/* ===== ٤) التبويبات ===== */}
            <nav className="flex gap-1 border-b">
              {TABS.map((t) => (
                <Link key={t.key} href={qs({ tab: t.key })}
                  className={t.key === tab
                    ? "border-b-2 border-brand-600 px-4 py-2 font-semibold text-brand-600"
                    : "px-4 py-2 text-gray-500 hover:text-brand-600"}>
                  {t.label}
                  {t.key === "errors" && s.q_errors + s.q_rejected > 0 && (
                    <span className="mr-1 rounded-full bg-red-100 px-1.5 text-xs text-red-700">{s.q_errors + s.q_rejected}</span>
                  )}
                </Link>
              ))}
            </nav>

            {tab === "overview" && (
              <section>
                <div className="mb-3 flex flex-wrap gap-2 text-sm">
                  <span className="text-gray-500">حسب:</span>
                  {DIMS.map((d) => (
                    <Link key={d.key} href={qs({ dim: d.key })}
                      className={d.key === dim ? "rounded-full bg-brand-600 px-3 py-0.5 text-white" : "rounded-full bg-gray-100 px-3 py-0.5 text-gray-700 hover:bg-gray-200"}>
                      {d.label}
                    </Link>
                  ))}
                </div>
                <BreakdownTable rows={breakdown.data} dim={dim} error={breakdown.error} />
              </section>
            )}

            {tab === "reconcile" && (
              <section className="space-y-3">
                <p className="rounded-lg border bg-white p-3 text-sm text-gray-600">
                  «أبلغت المنصّة» من مزامنة Meta اليومية (mkt_metrics_daily). «وصل النظام» = صفوف الدفتر لتلك الحملة من كل الأبواب.
                  الفجوة الموجبة = ليدات دفعت ثمنها ولم تصل: تحقّق من اشتراك الصفحة بالويبهوك، أو استورد ملف ليدات الحملة —
                  الاستيراد يتعرّف على ما وصل سابقاً بمعرّفه ولا يكرّره.
                  {!s.meta_connected && <strong className="block text-amber-700">Meta غير موصول: عمود «أبلغت المنصّة» فارغ، والمطابقة غير ممكنة حتى يُضاف التكامل.</strong>}
                </p>
                <ReconcileTable rows={breakdown.data} error={breakdown.error} />
              </section>
            )}

            {tab === "errors" && (
              <section className="space-y-3">
                {canManage !== true && (
                  <p className="rounded-lg border bg-white p-3 text-sm text-gray-600">
                    عدد ما في القائمة ظاهر أعلاه. معالجتها (بالأسماء والأرقام) للمدير ومدير المتابعة ومدير التسويق.
                  </p>
                )}
                {queue.error && <p className="text-sm text-red-700">{queue.error}</p>}
                {canManage === true && queue.data.length === 0 && (
                  <p className="rounded-lg border bg-white p-6 text-center text-sm text-gray-400">لا شيء ينتظر. كل ما وصل عولج.</p>
                )}
                {queue.data.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border bg-white">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500">
                        <tr>
                          <th className="p-2 text-right">وصل</th>
                          <th className="p-2 text-right">الباب / القناة</th>
                          <th className="p-2 text-right">الاسم</th>
                          <th className="p-2 text-right">الهاتف</th>
                          <th className="p-2 text-right">الحالة والسبب</th>
                          <th className="p-2 text-right">الإجراء</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queue.data.map((r) => (
                          <tr key={r.id} className="border-t align-top">
                            <td className="whitespace-nowrap p-2 text-xs text-gray-500">{baghdadDateLabel(r.received_at, { dateStyle: "short", timeStyle: "short" })}</td>
                            <td className="p-2 text-xs">{PROVIDER_LABEL[r.provider] ?? r.provider}<br /><span className="text-gray-500">{channelLabel(r.channel)}{r.campaign_ref ? ` · ${r.campaign_ref}` : ""}</span></td>
                            <td className="p-2">{r.name ?? "—"}{r.message && <p className="mt-1 max-w-xs truncate text-xs text-gray-500" title={r.message}>{r.message}</p>}</td>
                            <td className="p-2 font-mono text-xs" dir="ltr">{r.phone ?? "—"}{r.email && <span className="block text-gray-500">{r.email}</span>}</td>
                            <td className="p-2 text-xs">
                              <span className={r.status === "مرفوض" ? "rounded bg-amber-100 px-1.5 text-amber-800" : "rounded bg-red-100 px-1.5 text-red-800"}>{r.status}</span>
                              <p className="mt-1 text-gray-600">{r.reject_reason ?? r.last_error ?? (r.status === "بانتظار الجلب" ? "وصل الحدث وتُجلب التفاصيل" : "")}</p>
                              {r.attempts > 0 && <p className="text-gray-400">محاولات: {r.attempts}</p>}
                            </td>
                            <td className="p-2"><IntakeActions id={r.id} status={r.status} phone={r.phone} name={r.name} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {tab === "batches" && (
              <section className="overflow-x-auto rounded-lg border bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="p-2 text-right">الملف</th>
                      <th className="p-2 text-right">التاريخ</th>
                      <th className="p-2">أُرسل</th>
                      <th className="p-2">جديد</th>
                      <th className="p-2">رُبط بعميل قائم</th>
                      <th className="p-2">مرفوض</th>
                      <th className="p-2">خطأ</th>
                      <th className="p-2">سبق تسجيله</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id} className="border-t text-center">
                        <td className="p-2 text-right">{b.file_name ?? "—"}</td>
                        <td className="p-2 text-right text-xs text-gray-500">{baghdadDateLabel(b.created_at, { dateStyle: "short", timeStyle: "short" })}</td>
                        <td className="p-2 tabular-nums">{b.rows_sent}</td>
                        <td className="p-2 tabular-nums">{b.counts["مُحوَّل"] ?? 0}</td>
                        <td className="p-2 tabular-nums">{b.counts["مكرّر"] ?? 0}</td>
                        <td className="p-2 tabular-nums text-amber-700">{b.counts["مرفوض"] ?? 0}</td>
                        <td className="p-2 tabular-nums text-red-700">{b.counts["خطأ"] ?? 0}</td>
                        <td className="p-2 tabular-nums text-gray-500">{b.rows_already}</td>
                      </tr>
                    ))}
                    {batches.length === 0 && (
                      <tr><td colSpan={8} className="p-6 text-center text-gray-400">لا دفعات بعد.</td></tr>
                    )}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Completeness({ s }: { s: NonNullable<Awaited<ReturnType<typeof getLeadHubSummary>>["data"]> }) {
  const notes: { tone: "bad" | "warn"; text: string }[] = [];
  if (s.q_errors > 0) notes.push({ tone: "bad", text: `${s.q_errors} ليد لم تكتمل معالجته (خطأ أو بانتظار الجلب) — الأرقام أدناه ليست نهائية حتى تُعالَج.` });
  if (!s.meta_connected) notes.push({ tone: "warn", text: "Meta غير موصول: ليدات نماذج الإعلانات لا تصل تلقائياً. ما يظهر منها هنا هو ما سُجّل يدوياً أو استُورد من ملف." });
  else if (s.meta_last_sync && Date.now() - new Date(s.meta_last_sync).getTime() > 36 * 3600_000)
    notes.push({ tone: "warn", text: "آخر مزامنة Meta أقدم من ٣٦ ساعة — أرقام «أبلغت المنصّة» في المطابقة متأخّرة." });
  notes.push({ tone: "warn", text: "رسائل ماسنجر وإنستغرام وواتساب لا تكامل مباشر لها بعد: تدخل الدفتر حين تُسجَّل من «تسجيل ليد». ما لم يُسجَّل منها لا يُرى." });

  return (
    <section className="space-y-2">
      {notes.map((n, i) => (
        <p key={i} className={`rounded-lg border p-3 text-sm ${n.tone === "bad" ? "border-red-300 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          {n.text}
        </p>
      ))}
      {s.sources.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-gray-600">
          <span className="text-gray-500">آخر وصول:</span>
          {s.sources.map((x) => (
            <span key={x.provider} className="rounded-full border bg-white px-2 py-0.5">
              {PROVIDER_LABEL[x.provider] ?? x.provider}: {baghdadDateLabel(x.last_at, { dateStyle: "short", timeStyle: "short" })} · {x.n_30d} في ٣٠ يوماً
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Tile({ label, value, text, sub, tone, href }: {
  label: string; value?: number; text?: string; sub?: string; tone?: "ok" | "warn" | "bad" | "brand"; href?: string;
}) {
  const color = tone === "bad" ? "border-red-300 bg-red-50" : tone === "warn" ? "border-amber-200 bg-amber-50"
    : tone === "brand" ? "border-brand-200 bg-brand-50" : "bg-white";
  const body = (
    <div className={`h-full rounded-lg border p-3 ${color}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-800">{text ?? (value ?? 0).toLocaleString("en-US")}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

function BreakdownTable({ rows, dim, error }: { rows: Awaited<ReturnType<typeof getLeadBreakdown>>["data"]; dim: BreakdownDim; error: string | null }) {
  if (error) return <p className="text-sm text-red-700">{error}</p>;
  const name = (r: (typeof rows)[number]) =>
    dim === "provider" ? PROVIDER_LABEL[r.k ?? ""] ?? r.k ?? "—"
    : dim === "channel" ? channelLabel(r.k)
    : r.label ?? (r.k ? "—" : dim === "owner" ? "بلا مسؤول" : "غير محدّد");
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="p-2 text-right">{DIMS.find((d) => d.key === dim)?.label}</th>
            <th className="p-2">وصل</th><th className="p-2">جديد</th><th className="p-2">رُبط</th>
            <th className="p-2">مرفوض/معلّق</th><th className="p-2">بلا مسؤول</th>
            <th className="p-2">تواصل</th><th className="p-2">ضمن المهلة</th><th className="p-2">أول استجابة</th>
            <th className="p-2">حجز</th><th className="p-2">بيع</th><th className="p-2">ليد ← بيع</th>
          </tr>
        </thead>
        <tbody>
          {rows.filter((r) => r.received > 0).map((r) => (
            <tr key={r.k ?? "none"} className="border-t text-center tabular-nums">
              <td className="p-2 text-right">{name(r)}</td>
              <td className="p-2 font-semibold">{r.received}</td>
              <td className="p-2">{r.created}</td>
              <td className="p-2">{r.linked}</td>
              <td className={`p-2 ${r.rejected + r.pending ? "text-amber-700" : ""}`}>{r.rejected + r.pending}</td>
              <td className={`p-2 ${r.unassigned ? "font-semibold text-red-700" : ""}`}>{r.unassigned}</td>
              <td className="p-2">{pct(r.contacted, r.created + r.linked)}</td>
              <td className="p-2">{pct(r.in_sla, r.created + r.linked)}</td>
              <td className="p-2">{minutesLabel(r.avg_first_min)}</td>
              <td className="p-2">{r.reserved}</td>
              <td className="p-2">{r.sold}</td>
              <td className="p-2">{pct(r.sold, r.created)}</td>
            </tr>
          ))}
          {rows.every((r) => r.received === 0) && (
            <tr><td colSpan={12} className="p-6 text-center text-gray-400">لا ليدات في الفترة.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ReconcileTable({ rows, error }: { rows: Awaited<ReturnType<typeof getLeadBreakdown>>["data"]; error: string | null }) {
  if (error) return <p className="text-sm text-red-700">{error}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="p-2 text-right">الحملة</th>
            <th className="p-2">أبلغت المنصّة</th><th className="p-2">وصل النظام</th><th className="p-2">الفجوة</th>
            <th className="p-2">جديد</th><th className="p-2">رُبط</th><th className="p-2">مرفوض/معلّق</th><th className="p-2">بلا مسؤول</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const gap = r.platform_leads === null ? null : r.platform_leads - r.received;
            return (
              <tr key={r.k ?? "none"} className="border-t text-center tabular-nums">
                <td className="p-2 text-right">{r.label ?? (r.k ? "—" : "بلا حملة")}</td>
                <td className="p-2">{r.platform_leads ?? <span className="text-gray-400">لا بيانات منصّة</span>}</td>
                <td className="p-2 font-semibold">{r.received}</td>
                <td className={`p-2 font-semibold ${gap !== null && gap > 0 ? "text-red-700" : "text-gray-500"}`}>
                  {gap === null ? "—" : gap > 0 ? `${gap} لم تصل` : gap < 0 ? `+${-gap} من أبواب أخرى` : "مطابق"}
                </td>
                <td className="p-2">{r.created}</td>
                <td className="p-2">{r.linked}</td>
                <td className="p-2">{r.rejected + r.pending}</td>
                <td className="p-2">{r.unassigned}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-400">لا حملات في الفترة.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
