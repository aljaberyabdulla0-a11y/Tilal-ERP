import { createClient } from "@/lib/supabase/server";
import { requireMktRead } from "@/lib/marketing-guard";
import { isMarketingManager } from "@/lib/auth";
import { DEFAULT_USD_RATE, INTEGRATION_PROVIDERS } from "@/lib/marketing-style";
import { Badge, Card, PageHead } from "@/components/marketing/ui";
import { SimpleTable } from "@/components/marketing/table";
import RecordForm, { type FieldSpec } from "@/components/marketing/record-form";
import RpcForm from "@/components/marketing/rpc-form";
import { ToggleField } from "@/components/marketing/actions";
import SyncNow from "./sync-now";
import UsdRate from "./usd-rate";

// ============================================================
// التكاملات — Meta و Google و TikTok و LinkedIn و YouTube و Analytics
// و GTM و واتساب والبريد والرسائل.
//
// المفتاح يُكتب ولا يُقرأ: يذهب إلى Supabase Vault، ولا تعود منه إلى
// الشاشة إلا «محفوظ». تقرؤه دالّة الحافة marketing-sync وحدها
// (service_role). والسجلّ يحفظ ما حدث لا الحمولة.
//
// الجاهز اليوم: موصّل Meta (رؤى الإعلانات اليومية). الباقي إطارٌ
// مكتمل (اتصال، حالة، سجلّ، أخطاء، إعادة محاولة) بلا موصّل — والاستيراد
// بملف CSV يغطّيه حتى يُبنى.
// ============================================================
export default async function IntegrationsPage() {
  await requireMktRead();
  const supabase = await createClient();
  const [manager, { data: integrations }, { data: logs }, { data: accounts }] = await Promise.all([
    isMarketingManager(),
    supabase.from("mkt_integrations").select("*").order("created_at"),
    supabase.from("mkt_sync_logs").select("*").order("started_at", { ascending: false }).limit(40),
    supabase.from("mkt_accounts").select("id, name").eq("kind", "حساب إعلانات"),
  ]);
  const secrets = await Promise.all((integrations ?? []).map(async (i) => {
    const { data } = await supabase.rpc("mkt_has_integration_secret", { p_integration: i.id });
    return [i.id, data === true] as const;
  }));
  const hasSecret = new Map(secrets);
  const name = new Map((integrations ?? []).map((i) => [i.id, i.name]));
  const supabaseFunctions = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://<project>.supabase.co"}/functions/v1`;
  const fields: FieldSpec[] = [
    { name: "name", label: "الاسم", required: true },
    { name: "provider", label: "المنصّة", type: "select", required: true, options: Object.entries(INTEGRATION_PROVIDERS).map(([v, p]) => ({ value: v, label: p.label + (p.ready ? "" : " (إطار — بلا موصّل بعد)") })) },
    { name: "account_ref", label: "معرّف الحساب", ltr: true, placeholder: "act_1234567890" },
    { name: "page_ref", label: "معرّف صفحة فيسبوك (ليدات النماذج)", ltr: true, placeholder: "1234567890",
      hint: "لاستقبال ليدات النماذج الفورية — من «حول» الصفحة ← معرّف الصفحة" },
    { name: "account_id", label: "حساب الإعلانات في تلال", type: "select", options: (accounts ?? []).map((a) => ({ value: a.id, label: a.name })) },
    { name: "auth_type", label: "المصادقة", type: "select", options: [{ value: "token", label: "رمز وصول (System User)" }, { value: "oauth", label: "OAuth" }, { value: "api_key", label: "مفتاح API" }], required: true },
    { name: "sync_frequency", label: "المزامنة", type: "select", options: ["يدوي", "كل ساعة", "يومي"], required: true },
  ];

  return (
    <>
      <PageHead title="التكاملات" sub="اتصال المنصّات الإعلانية والتحليلات والرسائل. المفاتيح في Vault ولا تظهر في الواجهة أبداً." />
      {manager && (
        <RecordForm table="mkt_integrations" openLabel="تكامل جديد" initial={{ provider: "meta", auth_type: "token", sync_frequency: "يومي" }}
          fixed={{ mapping: { usd_rate: DEFAULT_USD_RATE } }} fields={fields} />
      )}

      <Card title="التكاملات">
        <SimpleTable empty="لا تكاملات. أضِف Meta بمعرّف حساب الإعلانات ورمز System User طويل الأمد."
          head={["التكامل", "المنصّة", "الحساب", "سعر الدولار", "الحالة", "المفتاح", "آخر مزامنة", "آخر نجاح", "الخطأ", ""]}
          rows={(integrations ?? []).map((i) => {
            const p = INTEGRATION_PROVIDERS[i.provider];
            return [
              i.name, <span key="p" className="text-xs">{p?.label ?? i.provider}{!p?.ready && <span className="block text-amber-700">بلا موصّل — استورد CSV</span>}</span>,
              <span key="a" dir="ltr" className="text-xs">{i.account_ref ?? "—"}{i.page_ref && <span className="block text-gray-400">page {i.page_ref}</span>}</span>,
              <UsdRate key="r" id={i.id} mapping={i.mapping} canEdit={manager} />,
              <Badge key="s">{i.status}</Badge>,
              <span key="k" className="text-xs">
                {hasSecret.get(i.id) ? "محفوظ في Vault" : <span className="text-amber-700">غير مضبوط</span>}
                {manager && <span className="mt-1 block"><RpcForm fn="mkt_set_integration_secret" fixed={{ p_integration: i.id }} openLabel={hasSecret.get(i.id) ? "بدّل المفتاح" : "اضبط المفتاح"} submitLabel="احفظ في Vault" compact
                  fields={[{ name: "p_secret", label: "الرمز/المفتاح", required: true, ltr: true, hint: "يُحفظ مشفّراً ولا يُعرض بعدها" }]} /></span>}
              </span>,
              <span key="ls" dir="ltr" className="text-xs">{i.last_sync_at?.slice(0, 16).replace("T", " ") ?? "—"}</span>,
              <span key="lo" dir="ltr" className="text-xs">{i.last_success_at?.slice(0, 16).replace("T", " ") ?? "—"}</span>,
              <span key="e" className="text-xs text-red-700">{i.last_error ?? ""}</span>,
              <span key="x" className="flex flex-col gap-1">
                {p?.ready && hasSecret.get(i.id) && i.account_ref && <SyncNow integrationId={i.id} />}
                {manager && i.provider === "meta" && hasSecret.get(i.id) && i.page_ref &&
                  <SyncNow integrationId={i.id} mode="subscribe_page" label="اشترك الصفحة بالليدات" />}
                {manager && <ToggleField table="mkt_integrations" id={i.id} column="is_active" value={i.is_active} />}
              </span>,
            ];
          })} />
      </Card>

      {manager && (integrations ?? []).length > 0 && (
        <Card title="تعديل التكامل">
          <div className="flex flex-col gap-2">
            {(integrations ?? []).map((i) => (
              <RecordForm key={i.id} table="mkt_integrations" id={i.id} initial={i} fields={fields}
                openLabel={`عدّل: ${i.name}`} openIcon="edit" title={i.name} />
            ))}
          </div>
        </Card>
      )}

      <Card title="سجلّ المزامنة">
        <SimpleTable empty="لا مزامنات بعد."
          head={["بدأ", "التكامل", "المصدر", "المحاولة", "الحالة", "صفوف", "الخطأ"]}
          rows={(logs ?? []).map((l) => [
            <span key="s" dir="ltr" className="text-xs">{l.started_at.slice(0, 19).replace("T", " ")}</span>, name.get(l.integration_id) ?? "—",
            l.trigger, l.attempt, <Badge key="st">{l.status}</Badge>, l.rows_in ?? "—", <span key="e" className="text-xs text-red-700">{l.error ?? ""}</span>,
          ])} />
      </Card>

      <Card title="ربط Meta — الخطوات">
        <ol className="list-decimal space-y-1 pe-5 text-sm text-gray-700">
          <li>في Business Manager: أنشئ System User، وامنحه حساب الإعلانات بصلاحية <span dir="ltr">ads_read</span>، وولّد له رمزاً طويل الأمد.</li>
          <li>هنا: «تكامل جديد» بمنصّة Meta ومعرّف الحساب (<span dir="ltr">act_…</span>)، ثم «اضبط المفتاح» والصق الرمز.</li>
          <li>«سعر الدولار» في الجدول: مصروف حسابٍ بالدولار يُحفظ بالدينار به (الافتراضي الرسمي {DEFAULT_USD_RATE.toLocaleString("en")}).</li>
          <li>«زامن الآن»: تُنشأ الحملات الإعلانية ومجموعاتها وإعلاناتها تلقائياً وتدخل مقاييس آخر ٧ أيام يومياً.</li>
          <li>الربط بحملة تلال تلقائيٌّ إن كان رمزها رقمَ حملة ميتا، أو حمل اسمها عند ميتا رمزها (<span dir="ltr">cmp-0001</span>). وإلا فاخترها لكل «حملة إعلانية» من صفحة الإعلانات.</li>
          <li>المزامنة التلقائية تعمل حسب «المزامنة» في التكامل: «يومي» مرةً في اليوم، و«كل ساعة» كل ساعة، و«يدوي» بالزرّ وحده (<span dir="ltr">sql/200</span>).</li>
        </ol>
      </Card>

      <Card title="ليدات النماذج الفورية (Lead Ads) — تصل لحظتها">
        <ol className="list-decimal space-y-1 pe-5 text-sm text-gray-700">
          <li>في Business Manager: امنح System User نفسه <b>الصفحة</b> أيضاً، وولّد رمزه بصلاحيات <span dir="ltr">ads_read، leads_retrieval، pages_show_list، pages_read_engagement، pages_manage_metadata، pages_manage_ads</span>. رمزٌ واحد يكفي للإعلانات والليدات.</li>
          <li>«تعديل التكامل»: أضِف معرّف الصفحة، و«بدّل المفتاح» بالرمز الجديد إن تغيّرت صلاحياته.</li>
          <li>في تطبيق Meta للمطوّرين ← Webhooks ← Page ← Subscribe: الرابط <span dir="ltr" className="font-mono text-xs">{supabaseFunctions}/meta-leads</span>، ورمز التحقّق نفسه المضبوط في <span dir="ltr">META_VERIFY_TOKEN</span>، ثم فعّل حقل <span dir="ltr">leadgen</span>. والتطبيق في وضع <span dir="ltr">Live</span>.</li>
          <li>«اشترك الصفحة بالليدات» في الجدول — بدونه لا يرسل ميتا شيئاً ولو ضُبط الويبهوك.</li>
          <li>جرّب بأداة <span dir="ltr">Lead Ads Testing Tool</span> من ميتا: يدخل الليد بوّابة الليدات فيُطبَّع رقمه ويُكشف تكراره ويُوزَّع، ولمسته «نموذج» على إعلانه وحملته.</li>
          <li>أخطاء الاستقبال (رمز منتهٍ، صلاحية ناقصة) تظهر في «جودة البيانات».</li>
        </ol>
      </Card>
    </>
  );
}
